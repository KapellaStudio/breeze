/* Live-weather contract test. No real network and no real location. */
'use strict';
const assert=require('node:assert/strict');
const weather=require('./weather');

(async()=>{
  weather.clearCache();
  const requests=[];
  const fakeFetch=async (url,opts={})=>{
    const target=String(url);requests.push({target,opts});
    if(target.startsWith('https://ipwho.is/')){
      return{
        ok:true,status:200,headers:{get:()=>null},
        json:async()=>({
          success:true,latitude:37.7749,longitude:-122.4194,
          city:'San Francisco',region:'California',country:'United States',country_code:'US'
        })
      };
    }
    if(target.startsWith('https://api.met.no/weatherapi/locationforecast/2.0/compact')){
      const expires=new Date(Date.now()+60*60*1000).toUTCString();
      return{
        ok:true,status:200,headers:{get:key=>String(key).toLowerCase()==='expires'?expires:null},
        json:async()=>({properties:{timeseries:[
          {time:'2026-08-24T00:00:00Z',data:{instant:{details:{air_temperature:16.2,relative_humidity:70,wind_speed:5}},next_1_hours:{summary:{symbol_code:'partlycloudy_day'},details:{probability_of_precipitation:10}}}},
          {time:'2026-08-24T06:00:00Z',data:{instant:{details:{air_temperature:18,relative_humidity:62,wind_speed:4}},next_6_hours:{summary:{symbol_code:'fair_day'},details:{probability_of_precipitation:30}}}},
          {time:'2026-08-24T12:00:00Z',data:{instant:{details:{air_temperature:12,relative_humidity:78,wind_speed:3}},next_6_hours:{summary:{symbol_code:'cloudy'},details:{probability_of_precipitation:5}}}}
        ]}})
      };
    }
    throw new Error('unexpected weather request '+target);
  };

  const first=await weather.current('fahrenheit',fakeFetch);
  assert.equal(requests.length,2);
  assert.match(requests[0].target,/^https:\/\/ipwho\.is\//);
  assert.match(requests[1].target,/lat=37\.77/);
  assert.match(requests[1].target,/lon=-122\.42/);
  assert.match(String(requests[1].opts?.headers?.['user-agent']||''),/^Breeze\/1\.3\.0/);
  assert.equal(first.temperature,61);
  assert.equal(first.condition,'Partly cloudy');
  assert.equal(first.high,64);
  assert.equal(first.low,54);
  assert.equal(first.precipitation,30);
  assert.equal(first.windUnit,'mph');
  assert.equal(first.location,'San Francisco, California');
  assert.equal(first.source,'MET Norway');
  assert.equal(first.locationSource,'ipwho.is');
  assert.equal(Object.hasOwn(first,'latitude'),false);
  assert.equal(Object.hasOwn(first,'longitude'),false);
  assert.equal(Object.hasOwn(first,'ip'),false);

  const second=await weather.current('fahrenheit',fakeFetch);
  assert.equal(requests.length,2,'weather and approximate location should be memory-cached');
  assert.equal(second.cached,true);

  assert.equal(weather.condition('clearsky_day'),'Clear');
  assert.equal(weather.condition('rain'),'Rain');
  assert.equal(weather.condition('snowshowers_day'),'Snow showers');
  assert.equal(weather.condition('heavyrainandthunder'),'Thunderstorms');
  assert.throws(()=>weather.coarse(91,-90,90),/invalid weather coordinate/);
  assert.throws(()=>weather.coarse('nope',-180,180),/invalid weather coordinate/);

  console.log('Breeze weather: keyless network-location privacy contract passed');
})().catch(err=>{console.error(err);process.exit(1);});
