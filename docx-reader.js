// DOCX text only: no HTML rendering, external resources, or document execution.
(function () {
  "use strict";
  var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  var LIMIT = 4 * 1024 * 1024;

  function readXml(entry) {
    return new Promise(function (resolve, reject) {
      var chunks = [], size = 0;
      var stream = entry.internalStream("uint8array");
      stream.on("data", function (chunk) {
        size += chunk.length;
        if (size > LIMIT) {
          stream.pause();
          chunks = [];
          reject(new Error("Word document text is too large (maximum 4 MB)."));
          return;
        }
        chunks.push(chunk);
      }).on("error", reject).on("end", function () {
        var bytes = new Uint8Array(size), offset = 0;
        chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.length; });
        try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch (err) { reject(new Error("Cannot read this Word document's text encoding.")); }
      }).resume();
    });
  }

  function extract(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported Word XML declarations.");
    var doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("The Word document contains invalid XML.");
    var body = doc.getElementsByTagNameNS(W, "body")[0];
    if (!body) throw new Error("Unsupported Word document. Save as a standard .docx file.");
    // Reject complex content rather than silently dropping or reordering captions.
    var unsupported = ["tbl", "txbxContent", "drawing", "pict", "ins", "del", "moveFrom", "moveTo", "sdt", "altChunk", "fldSimple", "fldChar", "footnoteReference", "endnoteReference", "numPr", "vanish", "sym"];
    if (unsupported.some(function (tag) { return body.getElementsByTagNameNS(W, tag).length; })) {
      throw new Error("Use a plain-text Word script without tables, images, text boxes, lists, fields, or tracked changes. You can also export the intended captions as .txt.");
    }
    var paragraphs = [];
    Array.from(body.children).forEach(function (p) {
      if (p.namespaceURI !== W || p.localName !== "p") {
        if (p.namespaceURI === W && p.localName === "sectPr") return;
        throw new Error("Unsupported Word content. Please use a plain-text .docx script or .txt.");
      }
      var text = "";
      Array.from(p.getElementsByTagName("*")).forEach(function (node) {
        if (node.namespaceURI !== W) return;
        if (node.localName === "t") text += node.textContent;
        else if (node.localName === "tab") text += "\t";
        else if (node.localName === "cr" || (node.localName === "br" && (!node.getAttributeNS(W, "type") || node.getAttributeNS(W, "type") === "textWrapping"))) text += "\n";
      });
      paragraphs.push(text);
    });
    return paragraphs.join("\n");
  }

  window.readDocxText = async function (buffer) {
    if (buffer.byteLength > 10 * 1024 * 1024) throw new Error("Word files must be 10 MB or smaller.");
    var zip;
    try { zip = await JSZip.loadAsync(buffer); }
    catch (err) { throw new Error("Cannot open this .docx file. It may be damaged or password-protected."); }
    if (Object.keys(zip.files).length > 2000) throw new Error("Word document is too complex. Export the script as .txt.");
    var document = zip.file("word/document.xml");
    if (!document) throw new Error("This is not a supported .docx file.");
    return extract(await readXml(document));
  };
})();
