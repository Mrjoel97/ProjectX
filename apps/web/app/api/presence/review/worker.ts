import { inspectRenderedPage } from "@pikar/core/webBrowserQuality";
import { WEB_CAROUSEL_SCRIPT_POLICY } from "@pikar/core/webCarouselRuntime";

/** Code-owned script only. Snapshot contract: playwright@1.61.1 in /opt/pikar-browser/node_modules
 * and its installed Chromium at PLAYWRIGHT_BROWSERS_PATH=/opt/pikar-browser/browsers.
 * Build that immutable snapshot separately; never install packages in a customer review job. */
export function presenceBrowserWorkerScript(): string {
  return `
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire('/opt/pikar-browser/package.json');
if(require('playwright/package.json').version!=='1.61.1')throw Error('BROWSER_SNAPSHOT_VERSION');
process.env.PLAYWRIGHT_BROWSERS_PATH='/opt/pikar-browser/browsers';
const {chromium}=require('playwright');
const input=JSON.parse(await readFile('/tmp/presence-review/input.json','utf8'));
const inspect=${inspectRenderedPage.toString()};
const browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update']});
const reports=[],screenshots=[];
try {
 for(const artifact of input.artifacts){
  for(const mode of [{width:1440,reduced:false},{width:390,reduced:false},{width:390,reduced:true}]){
   const context=await browser.newContext({viewport:{width:mode.width,height:1000},deviceScaleFactor:1,reducedMotion:mode.reduced?'reduce':'no-preference',javaScriptEnabled:true,serviceWorkers:'block'});
   try{
    const page=await context.newPage();page.setDefaultTimeout(10000);
    await context.route('**/*',async route=>{
     const request=route.request(),url=new URL(request.url());
     if(request.method()!=='GET'||url.origin!=='https://presence-review.invalid')return route.abort();
     if(url.pathname==='/p/'+input.routeSlug+'/'+artifact.pageSlug)return route.fulfill({status:200,contentType:'text/html',body:artifact.html,headers:{'Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; ${WEB_CAROUSEL_SCRIPT_POLICY}; connect-src 'none'; form-action 'none'; base-uri 'none'"}});
     const index=input.assets.findIndex(asset=>asset.path===url.pathname);
     if(index<0)return route.abort();
     return route.fulfill({status:200,contentType:input.assets[index].mimeType,body:await readFile('/tmp/presence-review/asset-'+index)});
    });
    await page.goto('https://presence-review.invalid/p/'+input.routeSlug+'/'+artifact.pageSlug,{waitUntil:'load',timeout:15000});
    const carousel=page.locator('.gallery-carousel');
    if(await carousel.count()){
     await page.waitForSelector('.gallery-carousel.is-ready');
     if(await carousel.locator('button').count()!==2)throw Error('CAROUSEL_CONTROLS');
     const track=carousel.locator('.gallery-track');
     const position=()=>track.evaluate(element=>getComputedStyle(element).transform);
     const initial=await position();
     await page.waitForTimeout(5100);
     if((await position()===initial)!==mode.reduced)throw Error('CAROUSEL_AUTOPLAY');
     const beforeNext=await position();
     await carousel.locator('[data-gallery-next]').click();
     await page.waitForTimeout(850);
     const advanced=await position();
     if(advanced===beforeNext)throw Error('CAROUSEL_NEXT');
     await carousel.locator('[data-gallery-previous]').click();
     await page.waitForTimeout(850);
     if(await position()===advanced)throw Error('CAROUSEL_ARROWS');
     // Focus leaves autoplay paused for stable layout inspection and screenshots.
     await carousel.locator('[data-gallery-next]').focus();
    }
    const initialHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
    if(initialHeight>12000)throw Error('PAGE_HEIGHT_LIMIT');
    // Exercise actual lazy-image loading over the complete document, not only its first screen.
    for(let y=0;y<initialHeight;y+=800)await page.evaluate(y=>window.scrollTo(0,y),y);
    await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete),{},{timeout:10000});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(1300);
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);
    if(height>12000)throw Error('PAGE_HEIGHT_LIMIT');
    reports.push(await page.evaluate(inspect));
    const bytes=await page.screenshot({fullPage:true,type:'jpeg',quality:70,timeout:10000});
    if(bytes.length>262144)throw Error('SCREENSHOT_SIZE_LIMIT');
    screenshots.push({pageSlug:artifact.pageSlug,viewportWidth:mode.width,reducedMotion:mode.reduced,width:mode.width,height,mimeType:'image/jpeg',sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')});
   }finally{await context.close();}
  }
 }
 const result={status:'captured',contentHash:input.contentHash,providerReceiptHash:input.providerReceiptHash,artifactHashes:input.artifacts.map(({pageSlug,contentHash})=>({pageSlug,contentHash})),reports,screenshots,fidelity:'not_assessed',visualContrast:'not_assessed'};
 const json=JSON.stringify(result);if(Buffer.byteLength(json)>3000000)throw Error('RESULT_SIZE_LIMIT');
 await writeFile('/tmp/presence-review/result.json',json);
}finally{await browser.close();}
`;
}
