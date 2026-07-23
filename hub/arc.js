// Arc on-chain reader — reads ERC-8004 agent state + ERC-8183 job state from
// Arc testnet via plain JSON-RPC (eth_call / eth_getLogs). No web3 libraries;
// minimal ABI encode/decode built on the shared keccak256.
//
// Everything here is READ-ONLY. It never signs or sends transactions.

import { keccak256 } from "./crypto.js";

// ---- Arc testnet constants (from the project's working scripts) ----
export const ARC = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  identityRegistry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
  reputationRegistry: "0x8004b663056a597dffe9eccc1965a193b7388713",
  validationRegistry: "0x8004cb1bf31daf7788923b405b754f57aceb4272",
  agenticCommerce: "0x0747eef0706327138c69792bf28cd525089e4583",
  usdc: "0x3600000000000000000000000000000000000000",
};

// ---- ABI helpers ----
const enc = new TextEncoder();
function keccakHex(str) {
  return "0x" + [...keccak256(enc.encode(str))].map(b => b.toString(16).padStart(2, "0")).join("");
}
// 4-byte function selector from a canonical signature, e.g. "ownerOf(uint256)".
export function selector(sig) {
  return keccakHex(sig).slice(0, 10);
}
// 32-byte topic0 for an event signature, e.g. "Transfer(address,address,uint256)".
export function topic0(sig) {
  return keccakHex(sig);
}
// Left-pad a hex value to 32 bytes (no 0x).
function pad32(hex) {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}
export function encodeUint(n) {
  return pad32(BigInt(n).toString(16));
}
export function encodeAddress(addr) {
  return pad32(addr.replace(/^0x/, "").toLowerCase());
}
// Decode a 32-byte word (from a 0x-hex return) at word index i.
function word(hex, i) {
  const h = hex.replace(/^0x/, "");
  return h.slice(i * 64, i * 64 + 64);
}
export function decodeUint(hex, i = 0) {
  const w = word(hex, i);
  return w ? BigInt("0x" + w) : 0n;
}
export function decodeAddress(hex, i = 0) {
  const w = word(hex, i);
  return "0x" + w.slice(24);
}
// Decode an ABI-encoded dynamic string return (offset, length, bytes).
export function decodeString(hex) {
  const h = hex.replace(/^0x/, "");
  if (h.length < 128) return "";
  const off = Number(BigInt("0x" + h.slice(0, 64))) * 2;
  const len = Number(BigInt("0x" + h.slice(off, off + 64))) * 2;
  const bytes = h.slice(off + 64, off + 64 + len);
  let s = "";
  for (let i = 0; i < bytes.length; i += 2) s += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
  try { return decodeURIComponent(escape(s)); } catch (_) { return s; }
}

// ---- JSON-RPC ----
async function rpc(method, params, rpcUrl) {
  const r = await fetch(rpcUrl || ARC.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "rpc error");
  return d.result;
}
// eth_call to a contract with pre-encoded calldata (0xselector + args).
export async function ethCall(to, data, rpcUrl) {
  return rpc("eth_call", [{ to, data }, "latest"], rpcUrl);
}
// eth_getLogs with a topic filter over an address (from block 0 by default).
// Public Arc RPC often rejects wide-range eth_getLogs, so we fall back to the
// arcscan Blockscout REST API (Etherscan-compatible), which handles full-range
// log queries reliably. Returns logs in the standard {topics,data,...} shape.
export async function getLogs(address, topics, rpcUrl, fromBlock = "0x0") {
  try {
    const r = await rpc("eth_getLogs", [{ address, topics, fromBlock, toBlock: "latest" }], rpcUrl);
    if (Array.isArray(r)) return r;
  } catch (_) { /* fall through to Blockscout */ }
  return getLogsBlockscout(address, topics);
}
// Blockscout getLogs fallback (arcscan). Supports topic0..topic3 with AND joins.
async function getLogsBlockscout(address, topics) {
  const p = new URLSearchParams({
    module: "logs", action: "getLogs", fromBlock: "0", toBlock: "latest", address,
  });
  const names = ["topic0", "topic1", "topic2", "topic3"];
  const present = [];
  topics.forEach((t, i) => { if (t) { p.set(names[i], t); present.push(i); } });
  // Blockscout needs explicit AND operators between consecutive present topics.
  for (let k = 1; k < present.length; k++) {
    p.set(`topic${present[k - 1]}_${present[k]}_opr`, "and");
  }
  try {
    const r = await fetch(ARC.explorer + "/api?" + p.toString());
    const d = await r.json();
    if (d.status === "1" && Array.isArray(d.result)) {
      // Normalize Blockscout shape → RPC-like {topics,data,transactionHash,blockNumber}.
      return d.result.map(x => ({
        topics: x.topics || [],
        data: x.data || "0x",
        transactionHash: x.transactionHash,
        blockNumber: x.blockNumber,
      }));
    }
  } catch (_) {}
  return [];
}

// ---- ERC-8004 agent reads (ERC-721 based Identity Registry) ----
// Standard ERC-721: ownerOf(uint256), tokenURI(uint256). ERC-8004 agentId = tokenId.
export async function readAgentOwner(agentId, rpcUrl) {
  const data = selector("ownerOf(uint256)") + encodeUint(agentId);
  try { return decodeAddress(await ethCall(ARC.identityRegistry, data, rpcUrl)); }
  catch (_) { return null; }
}
export async function readAgentURI(agentId, rpcUrl) {
  // Try tokenURI (ERC-721) then agentURI (ERC-8004 naming) as fallback.
  for (const sig of ["tokenURI(uint256)", "agentURI(uint256)"]) {
    try {
      const out = await ethCall(ARC.identityRegistry, selector(sig) + encodeUint(agentId), rpcUrl);
      const s = decodeString(out);
      if (s) return s;
    } catch (_) {}
  }
  return "";
}

// Confirm the agent's owner from the mint Transfer log (topic3 = tokenId).
// This is the reliable path the register script itself uses; ownerOf may fail
// on non-standard deployments, so we fall back to this.
export async function readAgentOwnerFromLog(agentId, rpcUrl) {
  try {
    const logs = await getLogs(ARC.identityRegistry, [
      topic0("Transfer(address,address,uint256)"), null, null, "0x" + encodeUint(agentId)
    ], rpcUrl);
    if (logs && logs.length) {
      const last = logs[logs.length - 1];
      return "0x" + last.topics[2].slice(26); // topic2 = to (owner)
    }
  } catch (_) {}
  return null;
}

// ---- ERC-8004 reputation (via giveFeedback logs) ----
// The register script calls giveFeedback(uint256 agentId, int128 value, uint8
// valueDecimals, ...). No read getter exists, so we count feedback events and
// average the value from logs. topic1 = agentId (if indexed); many ERC-8004
// deployments index the agentId — we filter defensively and also scan data.
export async function readReputation(agentId, rpcUrl) {
  const out = { count: 0, avgScore: null, raw: [] };
  // giveFeedback event name in ERC-8004 reference is "NewFeedback"; try common shapes.
  const candidateTopics = [
    topic0("NewFeedback(uint256,int128,uint8,string,string,string,string,bytes32)"),
    topic0("FeedbackGiven(uint256,int128,uint8)"),
    topic0("Feedback(uint256,int128)"),
  ];
  for (const t of candidateTopics) {
    try {
      const logs = await getLogs(ARC.reputationRegistry, [t, "0x" + encodeUint(agentId)], rpcUrl);
      if (logs && logs.length) {
        out.count = logs.length;
        // value is the second field; if indexed it's topic2, else first data word.
        let sum = 0, n = 0;
        for (const lg of logs) {
          let v = null;
          if (lg.topics && lg.topics[2]) v = Number(BigInt(lg.topics[2]) & ((1n << 128n) - 1n));
          else if (lg.data && lg.data.length >= 66) v = Number(decodeUint(lg.data, 0));
          if (v != null && !Number.isNaN(v)) { sum += v; n++; }
        }
        if (n) out.avgScore = Math.round(sum / n);
        return out;
      }
    } catch (_) {}
  }
  return out; // count 0 = no feedback found (honest empty state)
}

// ---- ERC-8183 jobs (via JobCreated logs) ----
// JobCreated(uint256 jobId, address client, address provider, address evaluator,
//   uint256 expectedEndDate, address jobToken). Indexed: jobId, client, provider.
export async function readJobs(owner, rpcUrl) {
  const out = [];
  const t0 = topic0("JobCreated(uint256,address,address,address,uint256,address)");
  const ownerTopic = owner ? ("0x" + encodeAddress(owner)) : null;
  // As client (topic2) or provider (topic3).
  for (const idx of [2, 3]) {
    try {
      const topics = [t0, null, null, null];
      topics[idx] = ownerTopic;
      const logs = await getLogs(ARC.agenticCommerce, topics, rpcUrl);
      for (const lg of logs || []) {
        const jobId = lg.topics[1] ? BigInt(lg.topics[1]).toString() : null;
        if (!jobId || out.find(j => j.jobId === jobId)) continue;
        out.push({
          jobId,
          client: "0x" + (lg.topics[2] || "").slice(26),
          provider: "0x" + (lg.topics[3] || "").slice(26),
          role: idx === 2 ? "client" : "provider",
          tx: lg.transactionHash,
          block: lg.blockNumber ? Number(BigInt(lg.blockNumber)) : null,
        });
      }
    } catch (_) {}
  }
  return out.slice(0, 50);
}

// ---- Aggregate: everything the dashboard needs for one agent ----
export async function fetchAgentState(agentId, rpcUrl) {
  const out = { agentId: String(agentId), owner: null, metadataURI: "", reputation: null, jobs: [], chainId: ARC.chainId, explorer: ARC.explorer, error: null };
  try {
    out.owner = await readAgentOwner(agentId, rpcUrl);
    if (!out.owner || /^0x0+$/.test(out.owner)) out.owner = await readAgentOwnerFromLog(agentId, rpcUrl);
    out.metadataURI = await readAgentURI(agentId, rpcUrl);
    out.reputation = await readReputation(agentId, rpcUrl);
    if (out.owner) out.jobs = await readJobs(out.owner, rpcUrl);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}
