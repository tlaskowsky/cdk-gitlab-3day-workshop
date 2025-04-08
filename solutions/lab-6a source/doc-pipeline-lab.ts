#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';
import { ComputeStack } from '../lib/compute-stack';
import { BasicTagger } from '../lib/tagging-aspect';
import { ComplianceAspect } from '../lib/compliance-aspect';

const app = new cdk.App();

// --- Read Context Variables ----
// Get prefix and environment passed via -c flags from CI/CD.
// Provide sensible defaults for local execution if context isn't passed.
const environment = app.node.tryGetContext('environment') || 'dev'; // Default to 'dev'
// Default prefix combines 'stuXX' and environment. Replace 'stuXX' if using a different default/variable.
const prefix = app.node.tryGetContext('prefix') || `stu20-${environment}`;
console.log(`Using Prefix: ${prefix}, Environment: ${environment}`);

// --- Determine Target Account and Region ---
// Read from context first, then environment variables
const targetAccount = app.node.tryGetContext('account') ||
                      process.env.CDK_DEFAULT_ACCOUNT ||
                      process.env.AWS_ACCOUNT_ID;
const targetRegion = app.node.tryGetContext('region') ||
                     process.env.CDK_DEFAULT_REGION ||
                     process.env.AWS_DEFAULT_REGION;

// Validate
if (!targetAccount) { throw new Error("Account context/variable not set"); }
if (!targetRegion) { throw new Error("Region context/variable not set"); }
console.log(`Targeting AWS Account: ${targetAccount} Region: ${targetRegion}`);

const deploymentProps = {
  env: { account: targetAccount, region: targetRegion },
};

// --- Instantiate Stacks with Prefixed IDs ---
// *** CHANGE: Use the prefix in the Stack ID ***
console.log('Instantiating CoreStack...');
const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

console.log('Instantiating ComputeStack...');
// *** CHANGE: Use the prefix in the Stack ID ***
const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
  ...deploymentProps,
  processingQueue: coreStack.queue,
  table: coreStack.table,
  inputBucket: coreStack.bucket,
  ecrRepoName: coreStack.ecrRepo.repositoryName // Pass repo name
});

// --- Apply Aspects ---
console.log('Applying aspects for tagging and compliance...');
cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
cdk.Aspects.of(app).add(new ComplianceAspect(), { priority: 10 }); // Apply Compliance Aspect with priority
console.log('Tagging and Compliance aspects applied.');

// --- Apply Required Tag Directly ---
// cdk.Tags.of(coreStack.table).add('PITR-Enabled', 'true'); // <<< ENSURE THIS IS REMOVED