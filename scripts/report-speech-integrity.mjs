#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { evaluateIntegrityReport } from './speech-integrity.mjs';
const [planPath, reportPath, outputPath] = process.argv.slice(2);
if (!planPath || !reportPath || !outputPath || process.argv.length !== 5) throw new Error('Usage: node scripts/report-speech-integrity.mjs plan.json report.json NEW-output.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
let output;
try {
  const planBytes = fs.readFileSync(planPath);
  const reportBytes = fs.readFileSync(reportPath);
  const report = JSON.parse(reportBytes);
  if (typeof report.workerSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(report.workerSha256)) throw new Error('Response report requires a valid worker SHA-256');
  if (report.planSha256 !== sha(planBytes)) throw new Error('Response report does not belong to this exact frozen plan');
  output = { ...evaluateIntegrityReport(JSON.parse(planBytes), report), planSha256: sha(planBytes),
    responseReportSha256: sha(reportBytes), workerSha256: report.workerSha256,
    scorerSha256: sha(fs.readFileSync(new URL('./speech-integrity.mjs', import.meta.url))),
    normalizationScorerSha256: sha(fs.readFileSync(new URL('./speech-score.mjs', import.meta.url))),
    runnerSha256: sha(fs.readFileSync(new URL(import.meta.url))) };
} catch (error) {
  output = { passed: false, failure: { name: error.name, message: error.message } };
}
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: output.passed, totalCases: output.totalCases, passingIntegrityCases: output.passingIntegrityCases, failure: output.failure }));
if (!output.passed) process.exitCode = 1;
