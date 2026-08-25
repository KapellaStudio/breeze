/* Breeze live local-weather service.
   Location is coarse, opt-in and network-derived. No IP address or coordinate
   is persisted, and no location value is ever exposed to web content. */
'use strict';

const GEO_ENDPOINT='https://ipwho.is/';
const WEATHER_ENDPOINT='https://api.met.no/weatherapi/locationforecast/2.0/compact';
const WEATHER_UA='Breeze/1.0 https://kapellaholdings.com/breeze';
const LOCATION_CACHE_MS=6*60*60*1000;
const WEATHER_CACHE_MS=20*60*1000;
let locationCache=null;
let weatherCache=null;

function coarse(value,min,max){
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error('invalid weather coordinate');
  return Math.round(n*100)/100;
}
function normalizeUnit(unit){return unit==='fahrenheit'?'fahrenheit':'celsius';}
function round(value){const n=Number(value);return Number.isFinite(n)?Math.round(n):null;}
function cToF(c){return c*9/5+32;}
function msToKmh(ms){return ms*3.6;}
function msToMph(ms){return ms*2.2369362921;}
function condition(symbol){
  const s=String(symbol||'').toLowerCase().replace(/_(day|night|polartwilight)$/,'');
  if(!s)return'Current weather';
  if(s.includes('thunder'))return'Thunderstorms';
  if(s.includes('snow'))return s.includes('shower')?'Snow showers':'Snow';
  if(s.includes('sleet'))return s.includes('shower')?'Sleet showers':'Sleet';
  if(s.includes('rain'))return s.includes('shower')?'Rain showers':'Rain';
  if(s.includes('fog'))return'Fog';
  if(s.includes('partlycloudy'))return'Partly cloudy';
  if(s.includes('cloudy'))return'Cloudy';
  if(s.includes('fair'))return'Mostly clear';
  if(s.includes('clearsky'))return'Clear';
  return s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,c=>c.toUpperCase());
}
function apparentC(tempC,humidity,windMs){
  const t=Number(tempC),rh=Number(humidity),w=Number(windMs);
  if(![t,rh,w].every(Number.isFinite))return null;
  const e=(rh/100)*6.105*Math.exp((17.27*t)/(237.7+t));
  return t+0.33*e-0.70*w-4.0;
}
function displayLocation(loc){
  const parts=[loc.city,loc.region].map(x=>String(x||'').trim()).filter(Boolean);
  return parts.length?parts.join(', '):String(loc.country||'Current network');
}
async function fetchJson(url,fetchImpl,headers={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json',...headers}});
    if(!response||!response.ok)throw new Error(`weather network ${response?.status||'unavailable'}`);
    return{data:await response.json(),headers:response.headers,status:response.status};
  }finally{clearTimeout(timer);}
}
async function resolveLocation(fetchImpl){
  if(locationCache&&Date.now()-locationCache.at<LOCATION_CACHE_MS)return locationCache.value;
  const {data}=await fetchJson(GEO_ENDPOINT,fetchImpl);
  if(data?.success===false)throw new Error(data?.message||'location lookup unavailable');
  const latitude=coarse(data?.latitude,-90,90),longitude=coarse(data?.longitude,-180,180);
  const value={latitude,longitude,city:String(data?.city||''),region:String(data?.region||''),country:String(data?.country||''),countryCode:String(data?.country_code||'')};
  locationCache={at:Date.now(),value};return value;
}
function forecastSummary(data){
  const rows=Array.isArray(data?.properties?.timeseries)?data.properties.timeseries:[];
  if(!rows.length)throw new Error('weather service returned no forecast');
  const first=rows[0]?.data||{},instant=first.instant?.details||{};
  const symbol=first.next_1_hours?.summary?.symbol_code||first.next_6_hours?.summary?.symbol_code||first.next_12_hours?.summary?.symbol_code||'';
  const start=Date.parse(rows[0]?.time||'')||Date.now(),cutoff=start+24*60*60*1000;
  const temps=[],precip=[];
  for(const row of rows){
    const ts=Date.parse(row?.time||'');if(Number.isFinite(ts)&&ts>cutoff)break;
    const d=row?.data||{},v=Number(d.instant?.details?.air_temperature);if(Number.isFinite(v))temps.push(v);
    for(const k of ['next_1_hours','next_6_hours','next_12_hours']){
      const p=Number(d[k]?.details?.probability_of_precipitation);if(Number.isFinite(p))precip.push(p);
    }
  }
  const tempC=Number(instant.air_temperature),humidity=Number(instant.relative_humidity),windMs=Number(instant.wind_speed);
  if(!Number.isFinite(tempC))throw new Error('weather service returned no temperature');
  return{tempC,feelsC:apparentC(tempC,humidity,windMs),highC:temps.length?Math.max(...temps):null,lowC:temps.length?Math.min(...temps):null,windMs:Number.isFinite(windMs)?windMs:null,humidity:Number.isFinite(humidity)?round(humidity):null,precipitation:precip.length?round(Math.max(...precip)):null,symbol,condition:condition(symbol),updatedAt:Date.now()};
}
async function loadForecast(loc,fetchImpl){
  const key=`${loc.latitude},${loc.longitude}`;
  if(weatherCache&&weatherCache.key===key&&Date.now()<weatherCache.expiresAt)return{...weatherCache.value,cached:true};
  const url=new URL(WEATHER_ENDPOINT);url.searchParams.set('lat',String(loc.latitude));url.searchParams.set('lon',String(loc.longitude));
  const {data,headers}=await fetchJson(url,fetchImpl,{'user-agent':WEATHER_UA});
  const value=forecastSummary(data);
  const serverExpiry=Date.parse(headers?.get?.('expires')||'');
  const expiresAt=Number.isFinite(serverExpiry)&&serverExpiry>Date.now()?serverExpiry:Date.now()+WEATHER_CACHE_MS;
  weatherCache={key,value,expiresAt};return{...value,cached:false};
}
function format(raw,loc,unit){
  const u=normalizeUnit(unit),f=u==='fahrenheit';
  const temp=n=>n==null?null:round(f?cToF(n):n);
  const wind=raw.windMs==null?null:round(f?msToMph(raw.windMs):msToKmh(raw.windMs));
  return{
    temperature:temp(raw.tempC),feelsLike:temp(raw.feelsC),high:temp(raw.highC),low:temp(raw.lowC),
    wind,precipitation:raw.precipitation,humidity:raw.humidity,condition:raw.condition,
    unit:f?'F':'C',windUnit:f?'mph':'km/h',updatedAt:raw.updatedAt,cached:!!raw.cached,
    location:displayLocation(loc),countryCode:loc.countryCode,source:'MET Norway',locationSource:'ipwho.is'
  };
}
async function current(unit='celsius',fetchImpl=globalThis.fetch){
  if(typeof fetchImpl!=='function')throw new Error('weather network unavailable');
  const loc=await resolveLocation(fetchImpl);const raw=await loadForecast(loc,fetchImpl);return format(raw,loc,unit);
}
function clearCache(){locationCache=null;weatherCache=null;}

module.exports={current,condition,coarse,clearCache,forecastSummary,LOCATION_CACHE_MS,WEATHER_CACHE_MS};
