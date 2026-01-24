// domBatcher.ts
import { kickSpring } from './springTicker';

type Commit = () => void;

const commits = new Set<Commit>();

export function requestDomCommit(fn: Commit) {
  commits.add(fn);
  // ✅ гарантируем, что тикер проснётся даже если springs уже стоят
  kickSpring();
}

export function flushDomCommits() {
  if (!commits.size) return;

  // ✅ без лишних аллокаций Array.from
  for (const c of commits) c();
  commits.clear();
}

export function hasDomCommits() {
  return commits.size > 0;
}
