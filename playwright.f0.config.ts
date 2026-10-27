import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/f0',workers:1,retries:0,timeout:180000,expect:{timeout:15000},
  use:{channel:'chromium',baseURL:'http://127.0.0.1:4186',viewport:{width:412,height:915},hasTouch:true,isMobile:true,
    launchOptions:{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
  webServer:{command:'npx tsx scripts/f0-e2e-server.ts',url:'http://127.0.0.1:4186/api/v1/health',reuseExistingServer:false,timeout:60000},
});
