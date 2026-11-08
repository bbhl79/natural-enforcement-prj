// 旅程门禁入口。只打印 JSON。exit 0 才允许随后的隔离 dev up。
import { evaluateJourneyIsolation } from './journey-isolation.ts';

const decision = evaluateJourneyIsolation(process.env);
process.stdout.write(`${JSON.stringify(decision)}\n`);
if (!decision.ok) process.exitCode = 2;
