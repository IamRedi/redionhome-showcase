import net from 'node:net';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
import {URL} from 'node:url';

export function loopback(host) {
  return ['localhost','127.0.0.1','::1','[::1]','::ffff:127.0.0.1'].includes(String(host).toLowerCase());
}
const denied = () => new Error('Offline showcase: external connections are disabled');
if (!globalThis.__redionhomeOffline) {
  const connect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(...args) {
    const first=args[0];
    // Node normalizes connect arguments into an array in several built-ins.
    const values=Array.isArray(first)?first:args;
    const options=values[0];
    if(typeof options==='object'&&options!==null) {
      if(!options.path&&!loopback(options.host??'localhost'))throw denied();
    } else if(typeof options==='number') {
      if(typeof values[1]==='string'&&!loopback(values[1]))throw denied();
    } else if(typeof options==='string'&&!options.startsWith('/')&&!options.startsWith('\\\\')) {
      throw denied();
    }
    return connect.apply(this,args);
  };
  const lookup=dns.lookup;
  dns.lookup=function(host,...args) {
    if(!loopback(host)&&!net.isIP(String(host)))throw denied();
    return lookup.call(this,host,...args);
  };
  const promiseLookup=dns.promises.lookup;
  dns.promises.lookup=async function(host,...args) {
    if(!loopback(host)&&!net.isIP(String(host)))throw denied();
    return promiseLookup.call(this,host,...args);
  };
  const fetch=globalThis.fetch;
  globalThis.fetch=function(input,options) {
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(!loopback(url.hostname))return Promise.reject(denied());
    return fetch(input,options);
  };
  syncBuiltinESMExports();
  globalThis.__redionhomeOffline=true;
}
