const { chromium } = require('playwright');
const JSZip = require('../vendor/jszip.min.js');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || undefined});
 try {
 const page = await browser.newPage({acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
 async function docx(xml){const z=new JSZip();z.file('word/document.xml',xml);return z.generateAsync({type:'nodebuffer'});}
 const wrap=body=>'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>';
 const para=t=>'<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>';
 const fixture=await docx(wrap(para('First line')+para('Second line')+para('   ')+para('Next block')));
 const extract=async buffer=>page.evaluate(async bytes=>window.readDocxText(new Uint8Array(bytes).buffer),Array.from(buffer));
 assert.equal(await extract(fixture),'First line\nSecond line\n   \nNext block');
 assert.equal(await extract(await docx(wrap('<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t></w:r></w:p>'))),'A\nB');
 for(const xml of [wrap('<w:tbl/>'),wrap('<w:ins/>'),'<broken>',wrap('<w:p><w:r><w:t>'+ 'a'.repeat(4*1024*1024)+'</w:t></w:r></w:p>')]){
  await assert.rejects(extract(await docx(xml)));
 }
 await assert.rejects(extract(Buffer.from('invalid zip')));
 const input=process.argv[2]?fs.readFileSync(process.argv[2]):fixture;
 const expected=process.argv[2]?12:2;
 await page.locator('#estimate-form input[type=file]').setInputFiles({name:'script.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:input});
 async function download(button){const [d]=await Promise.all([page.waitForEvent('download'),button.click()]);return fs.readFileSync(await d.path(),'utf8');}
 const generated=await download(page.locator('#estimate-form button[type=submit]'));
 const count=text=>(text.match(/ --> /g)||[]).length;
 assert.equal(count(generated),expected);
 await page.locator('#resync-form input[name=txt]').setInputFiles({name:'script.docx',mimeType:'application/octet-stream',buffer:input});
 await page.locator('#resync-form input[name=srt]').setInputFiles({name:'timing.srt',mimeType:'application/octet-stream',buffer:Buffer.from(generated)});
 assert.equal(await download(page.locator('button[value=normal]')),generated);
 assert.equal(count(await download(page.locator('button[value=pr2022]'))),expected+1);
 await page.locator('#estimate-form input[type=file]').setInputFiles({name:'script.txt',mimeType:'text/plain',buffer:Buffer.from('First\nline\n\nSecond')});
 assert.equal(count(await download(page.locator('#estimate-form button[type=submit]'))),2);
 const tip=page.locator('#estimate-example');assert.equal(await tip.evaluate(el=>getComputedStyle(el).visibility),'hidden');
 await page.locator('.example-anchor').first().hover();await page.waitForFunction(()=>getComputedStyle(document.getElementById('estimate-example')).visibility==='visible');assert.equal(await tip.evaluate(el=>getComputedStyle(el).visibility),'visible');
 await page.mouse.move(0,0);await page.locator('.example-anchor').last().focus();await page.waitForFunction(()=>getComputedStyle(document.getElementById('resync-example')).visibility==='visible');assert.equal(await page.locator('#resync-example').evaluate(el=>getComputedStyle(el).visibility),'visible');
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('resync-example')).opacity==='1');
 await page.screenshot({path:'/tmp/shorts-remap-preview.png',fullPage:true});
 for (const width of [390, 1280]) {
  await page.setViewportSize({width,height:844});
  for (const id of ['estimate-example','resync-example']) {
   await page.locator('[aria-describedby="'+id+'"]').focus();
   const box=await page.locator('#'+id).boundingBox();
   assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=844);
   assert.ok(await page.locator('#'+id+' img').evaluate(img=>img.complete && img.naturalWidth>0));
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: DOCX parsing, blank paragraphs, soft breaks, malformed/unsupported/oversized content, TXT, Generate, both Resync modes, hover and keyboard tips. Real fixture blocks: '+expected);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
