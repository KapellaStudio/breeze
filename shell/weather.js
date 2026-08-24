/* Breeze local-weather service.
   Receives only coarse coordinates from trusted chrome, never stores them on
   disk, and returns weather facts without echoing location back to renderer. */
'use strict';

const ENDPOINT='https://api.open-meteo.com/v1/forecast';
const CACHE_MS=10*60*1000;
const cache=new Map();

function coarse(value,min,max){
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error('invalid weather coordinate');
  return Math.round(n*100)/100;
}
function normalizeUnit(unit){return unit==='fahrenheit'?'fahrenheit':'celsius';}
function condition(code){
  const n=Number(code);
  if(n===0)return'Clear';
  if(n===1)return'Mostly clear';
  if(n===2)return'Partly cloudy';
  if(n===3)return'Overcast';
  if(n===45||n===48)return'Fog';
  if(n>=51&&n<=57)return'Drizzle';
  if(n>=61&&n<=65)return'Rain';
  if(n===66||n===67)return'Freezing rain';
  if(n>=71&&n<=77)return'Snow';
  if(n>=80&&n<=82)return'Rain showers';
  if(n===85||n===86)return'Snow showers';
  if(n>=95&&n<=99)return'Thunderstorms';
  return'Current weather';
}
function round(value){const n=Number(value);return Number.isFinite(n)?Math.round(n):null;}

async function current(lat,lon,unit='celsius',fetchImpl=globalThis.fetch){
  const latitude=coarse(lat,-90,90),longitude=coarse(lon,-180,180),u=normalizeUnit(unit);
  const key=`${latitude},${longitude},${u}`;const hit=cache.get(key);
  if(hit&&Date.now()-hit.at<CACHE_MS)return{...hit.value,cached:true};
  if(typeof fetchImpl!=='function')throw new Error('weather network unavailable');
  const url=new URL(ENDPOINT);
  url.searchParams.set('latitude',String(latitude));
  url.searchParams.set('longitude',String(longitude));
  url.searchParams.set('current','temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m');
  url.searchParams.set('daily','temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('temperature_unit',u);
  url.searchParams.set('wind_speed_unit',u==='fahrenheit'?'mph':'kmh');
  url.searchParams.set('timezone','auto');
  url.searchParams.set('forecast_days','1');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
  let response;
  try{response=await fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json'}});}finally{clearTimeout(timer);}
  if(!response||!response.ok)throw new Error(`weather service ${response?.status||'unavailable'}`);
  const data=await response.json();const c=data?.current||{},d=data?.daily||{};
  const temp=round(c.temperature_2m),feels=round(c.apparent_temperature),high=round(d.temperature_2m_max?.[0]),low=round(d.temperature_2m_min?.[0]),wind=round(c.wind_speed_10m),precip=round(d.precipitation_probability_max?.[0]);
  if(temp==null)throw new Error('weather service returned no temperature');
  const value={
    temperature:temp,feelsLike:feels,high,low,wind,precipitation:precip,
    weatherCode:Number.isFinite(Number(c.weather_code))?Number(c.weather_code):null,
    condition:condition(c.weather_code),isDay:c.is_day===1,unit:u==='fahrenheit'?'F':'C',
    windUnit:u==='fahrenheit'?'mph':'km/h',timezone:String(data?.timezone||''),updatedAt:Date.now(),cached:false
  };
  cache.set(key,{at:Date.now(),value});
  return value;
}
function clearCache(){cache.clear();}

module.exports={current,condition,coarse,clearCache,CACHE_MS};
