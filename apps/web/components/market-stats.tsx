"use client";
import {useEffect,useState} from 'react';
interface Stats{available:boolean;marketCapSol:number;liquiditySol:number;volume1hSol:number|null;asOf:number;currency:'USD'|'TEST_SOL';marketCapUsd:number|null;liquidityUsd:number|null;volume1hUsd:number|null}
export function MarketStats({mint,createdAt,refresh}:{mint:string;createdAt:number;refresh:number}) {
 const [stats,setStats]=useState<Stats|null>(null),[now,setNow]=useState<number|null>(null);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{let cancelled=false;setStats(null);const load=()=>fetch(`/api/token/${mint}/market`,{signal:AbortSignal.timeout(30000),cache:'no-store'}).then(response=>response.json()).then(value=>{if(!cancelled)setStats(value.available?value:null);}).catch(()=>{});void load();const timer=setInterval(load,30000);return()=>{cancelled=true;clearInterval(timer)};},[mint,refresh]);
 const minutes=now===null?null:Math.max(0,Math.floor(now/60000-createdAt/60));
 const age=minutes===null?'—':minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h ${minutes%60}m`:`${Math.floor(minutes/1440)}d`;
 const usd=stats?.currency==='USD'||process.env.NEXT_PUBLIC_SOLANA_CLUSTER==='mainnet-beta';
 const number=(value:number|null|undefined)=>value==null?'Unavailable':usd?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value):value.toLocaleString('en-US',{maximumFractionDigits:3});
 const unit=usd?'USD':'SOL';
 const volume=usd?stats?.volume1hUsd:stats?.volume1hSol;
 return <article className="card"><div className="panel-title"><h2>Market overview</h2><span>{usd?'USD':'SOL'}</span></div><div className="market-stats-grid"><div><span className="label">Market cap</span><strong>{number(usd?stats?.marketCapUsd:stats?.marketCapSol)}</strong><small>{unit}</small></div><div><span className="label">Token age</span><strong>{age}</strong><small>since launch</small></div><div><span className="label">1h volume</span><strong>{number(volume)}</strong><small>{volume==null?'Data not available':`${unit} traded`}</small></div><div><span className="label">Liquidity</span><strong>{number(usd?stats?.liquidityUsd:stats?.liquiditySol)}</strong><small>{unit} equivalent</small></div></div><p className="small" style={{marginTop:18,marginBottom:0,fontSize:10}}>Market cap uses current minted supply and pool price. Liquidity values both pool assets at that price. {usd?'USD values use the current SOL/USD price. 1h volume is valued at that same price.':'SOL values are shown without conversion to USD.'}</p></article>;
}
