"use client";
import {useEffect,useState} from 'react';
interface Stats{available:boolean;marketCapSol:number;liquiditySol:number;volume1hSol:number|null;asOf:number}
export function MarketStats({mint,createdAt,refresh}:{mint:string;createdAt:number;refresh:number}) {
 const [stats,setStats]=useState<Stats|null>(null),[now,setNow]=useState<number|null>(null);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{let cancelled=false;setStats(null);fetch(`/api/token/${mint}/market`,{signal:AbortSignal.timeout(30000),cache:'no-store'}).then(response=>response.json()).then(value=>{if(!cancelled)setStats(value.available?value:null);}).catch(()=>{});return()=>{cancelled=true};},[mint,refresh]);
 const minutes=now===null?null:Math.max(0,Math.floor(now/60000-createdAt/60));
 const age=minutes===null?'—':minutes<60?`${minutes}m`:minutes<1440?`${Math.floor(minutes/60)}h ${minutes%60}m`:`${Math.floor(minutes/1440)}d`;
 const number=(value:number|undefined)=>value===undefined?'—':value.toLocaleString('en-US',{maximumFractionDigits:3});
 return <article className="card"><div className="panel-title"><h2>Market overview</h2><span>TEST SOL</span></div><div className="market-stats-grid"><div><span className="label">Market cap</span><strong>{number(stats?.marketCapSol)}</strong><small>test SOL</small></div><div><span className="label">Token age</span><strong>{age}</strong><small>since launch</small></div><div><span className="label">1h volume</span><strong>{stats?.volume1hSol==null?'Unavailable':number(stats.volume1hSol)}</strong><small>{stats?.volume1hSol==null?'History not available':'test SOL traded'}</small></div><div><span className="label">Liquidity</span><strong>{number(stats?.liquiditySol)}</strong><small>test SOL equivalent</small></div></div><p className="small" style={{marginTop:18,marginBottom:0,fontSize:10}}>Market cap uses current minted supply and pool price. Liquidity values both pool assets at that price. Devnet values are test SOL; no USD value is implied.</p></article>;
}
