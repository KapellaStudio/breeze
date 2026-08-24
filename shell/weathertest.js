/* Live-weather contract test. No real network and no real location. */
'use strict';
const assert=require('node:assert/strict');
const weather=require('./weather');

(async()=>{
  weather.clearCache();
  let calls=0,captured='';
  const fakeFetch=async url=>{
    calls++;captured=String(url);
    return{ok:true,json:async()=>({
      latitude:37.77,longitude:-122.42,timezone:'America/Los_Angeles',
      current:{temperature_2m:61.2,apparent_temperature:60.6,is_day:1,weather_code:2,wind_speed_10m:11.4},
      daily:{temperature_2m_max:[66.4],temperature_2m_min:[53.2],precipitation_probability_max:[18]}
    })};
  };

  const first=await weather.current(37.7749,-122.4194,'fahrenheit',fakeFetch);
  assert.match(captured,/latitude=37\.77/);
  assert.match(captured,/longitude=-122\.42/);
  assert.match(captured,/temperature_unit=fahrenheit/);
  assert.equal(first.temperature,61);
  assert.equal(first.condition,'Partly cloudy');
  assert.equal(first.high,66);
  assert.equal(first.low,53);
  assert.equal(first.precipitation,18);
  assert.equal(first.windUnit,'mph');
  assert.equal(Object.hasOwn(first,'latitude'),false);
  assert.equal(Object.hasOwn(first,'longitude'),false);

  const second=await weather.current(37.774,-122.421,'fahrenheit',fakeFetch);
  assert.equal(calls,1,'same coarse location should use memory cache');
  assert.equal(second.cached,true);

  assert.equal(weather.condition(0),'Clear');
  assert.equal(weather.condition(63),'Rain');
  assert.equal(weather.condition(75),'Snow');
  assert.equal(weather.condition(96),'Thunderstorms');
  assert.throws(()=>weather.coarse(91,-90,90),/invalid weather coordinate/);
  assert.throws(()=>weather.coarse('nope',-180,180),/invalid weather coordinate/);

  console.log('Breeze weather: live-service privacy contract passed');
})().catch(err=>{console.error(err);process.exit(1);});
