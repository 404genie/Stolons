// Earlier integration-test mints stay on-chain and addressable, but are not
// included in public devnet discovery or its headline counts.
export const INTERNAL_DEVNET_MINTS = new Set([
  'EuUhRmnWWiV9nvVoSumk7hTCeYnMtoRgYZ1ckCx98ebe',
  '3ksrzDpVqzfcocbQAMj7YZzZsE2cFK3VHB93k5eDnyMC',
  'GKQWxEXuhPCKH4awCBJ4gb2QSiS2xEUcDxyFAwVTfrg6',
  'DZUruCVm77j3avt7fjSCkizNeex6SFuTqWC9uasK76Pz',
  '2LjFu7q9TAjpD15GYV2YYDtsuZYheBJSsL43DrySEZXm',
  'AHiWHhZpWwCQCENcsXLrrfywUNnJSqraSAnKnLq3ZcJj',
  '7Npk5HdR7LBv26CuqsV5aZC4V7nQ93rWVc4oPQWRkK3p',
  '5PQ257gpiW288CB2dFtYVKRwAShe2iN6HwQyXyDXgyoW',
  '6bQBYEUZd9M64ZFSRu93HgDzDpPfoZnuyVwHsvq77q54',
  '3jXAR6xsXFtvGnk7nXX5P98MgrEQuH8Jxn4rovcE15EW'
]);
export function publicDiscoveryEntries<T extends {mint:{toBase58():string}}>(entries:T[],cluster:string):T[]{
  return cluster==='devnet'?entries.filter(entry=>!INTERNAL_DEVNET_MINTS.has(entry.mint.toBase58())):entries;
}
