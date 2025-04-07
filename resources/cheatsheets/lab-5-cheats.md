---
layout: default
title: Lab 5 Cheatsheet
parent: Cheatsheets
grand_parent: Resources
nav_order: 5
---

# Lab 5 Troubleshooting Tips (Testing, Aspects, Monitoring)

This covers key concepts and common issues encountered when adding tests, compliance aspects, and monitoring in Lab 5.

## 1. Jest Testing with CDK Assertions

* **Setup:**
    * Install necessary dev dependencies: `npm install --save-dev jest @types/jest ts-jest @types/node` (ensure `@types/node` is present).
    * Create `jest.config.js` pointing to your `test` directory.
    * Add `"test": "jest"` to your `package.json` scripts.
* **Test Structure:** Use `describe(...)` for suites and `test(...)` or `it(...)` for individual cases. Use `beforeAll` or `beforeEach` for setup (like creating the App/Stack).
* **Synthesizing for Tests:** Use `Template.fromStack(stack)` from `aws-cdk-lib/assertions` to generate the CloudFormation template *in memory* based on your CDK code. **Important:** Assertions run against this *synthesized template*, not live AWS resources.
* **Applying Aspects in Tests:** If you need to test the *effects* of Aspects (like tags added or validations performed), you **must apply the Aspects** to the test `app` or `stack` scope within your test file (usually in `beforeAll`) **before** calling `Template.fromStack()`. Use the same priority as in `bin/app.ts` if relevant.
    ```typescript
    // Inside beforeAll in test file
    // ... create app, stack ...
    cdk.Aspects.of(app).add(new BasicTagger(...));
    cdk.Aspects.of(app).add(new ComplianceAspect(), { priority: 10 }); // Apply aspect with priority
    template = Template.fromStack(stack); // Synthesize AFTER applying aspects
    ```
* **Common Assertions:**
    * `template.resourceCountIs('AWS::ResourceType::Name', count)`: Checks number of resources of a specific type. (Be careful with Lambdas, as CDK creates helpers).
    * `template.hasResourceProperties('AWS::ResourceType::Name', { PropName: 'Value', ... })`: Checks if at least one resource of the type exists with the specified properties.
* **Using `Match`:** Import `Match` from `aws-cdk-lib/assertions` for flexible assertions:
    * `Match.absent()`: Assert a property should not exist (e.g., initial PITR).
    * `Match.objectLike({...})`: Check for partial object match within nested properties.
    * `Match.arrayWith([...])`: Check if an array property contains specific items (useful for IAM policy statements or tags). Use with `Match.objectLike` inside for complex items. E.g., `Action: Match.arrayWith(["sqs:SendMessage"])`.
* **Snapshot Testing:**
    * `expect(template.toJSON()).toMatchSnapshot();`: Compares the full template JSON to a stored snapshot file (`.snap`).
    * **Updating:** Run `npm test -- -u` (or `jest -u`) locally to update snapshots after intentional code changes. **Commit the updated `.snap` file.**
    * **Dynamic Values:** Avoid dynamic values (like `Date.now()`) in resource properties that are part of snapshots, as they cause tests to fail on every run. Remove them or find deterministic alternatives.

## 2. CDK Aspects for Compliance/Validation

* **Purpose:** Apply cross-cutting logic or checks (e.g., tagging, security settings, compliance rules) across constructs during synthesis.
* **Implementation:** Create a class implementing `cdk.IAspect` with a `visit(node: IConstruct)` method. Apply using `cdk.Aspects.of(scope).add(new MyAspect(), { priority: X });`. Lower priority numbers run earlier.
* **Validation:** Inside `visit`, check node properties. Use `cdk.Annotations.of(node).addError('Error message')` to fail synthesis if a rule is violated. Use `addWarning` or `addInfo` for non-blocking messages.
* **Checking L1 Properties:** To validate based on the final CloudFormation properties (especially if L2 defaults are complex or might change), access the underlying Cfn resource: `const cfnResource = node.node.defaultChild as ResourceType.CfnResource;`. Check properties on `cfnResource` (e.g., `cfnTable.pointInTimeRecoverySpecification`). Be aware properties might be `IResolvable` (tokens). Checking for *existence* (`if (cfnTable.someProperty)`) is often safer during synth than checking specific tokenized values.
* **Applying Tags within Aspect:** Calling the L2 `cdk.Tags.of(node).add()` inside an Aspect's `visit` method can sometimes cause priority conflicts during synthesis (especially in tests). It's often more reliable to use the L1 Cfn resource's tag manager if tagging conditionally within an Aspect:
    ```typescript
    if (node instanceof dynamodb.Table) {
      const cfnTable = node.node.defaultChild as dynamodb.CfnTable;
      if (cfnTable.pointInTimeRecoverySpecification) { // If compliant...
        cfnTable.tags.setTag('PITR-Enabled', 'true'); // ...add tag via Cfn
      } // ...
    }
    ```
* **SCP Integration:** Aspects are great for ensuring CDK code produces resources that comply with SCPs (e.g., by validating settings or adding required tags), failing the build *before* deployment hits an SCP block.

## 3. Monitoring (CloudWatch/SNS)

* **Key Constructs:** `aws-cdk-lib/aws-sns` (`sns.Topic`), `aws-cdk-lib/aws-sns-subscriptions` (`subs.EmailSubscription`), `aws-cdk-lib/aws-cloudwatch` (`cloudwatch.Alarm`, `cloudwatch.Metric`), `aws-cdk-lib/aws-cloudwatch-actions` (`cw_actions.SnsAction`).
* **Metrics:** Use L2 construct helper methods where available (e.g., `queue.metricApproximateNumberOfMessagesVisible({...})`). Specify `period` and `statistic`.
* **Alarms:** Define `threshold`, `evaluationPeriods`, `comparisonOperator`. Use `treatMissingData` (e.g., `NOT_BREACHING`) to handle initial state.
* **Actions:** Use `alarm.addAlarmAction(new cw_actions.SnsAction(topic))` to link alarms to SNS topics.
* **Email Subscription:** Requires manual confirmation via email link after deployment.

## 4. CI/CD Integration

* **Running Tests:** Add `npm test` to the `script:` section of your `build_cdk` job in `.gitlab-ci.yml` (usually placed after `npm run build` and `npx cdk synth`).
* **Failure:** If any Jest test fails, `npm test` will exit with a non-zero code, causing the `build_cdk` job and the entire pipeline to fail, preventing deployment of faulty code.