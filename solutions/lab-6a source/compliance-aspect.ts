// lib/compliance-aspect.ts (Corrected PITR Check - Existence Check v2)
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class ComplianceAspect implements cdk.IAspect {
  public visit(node: IConstruct): void {
    // Check if the node is a DynamoDB Table L2 construct
    if (node instanceof dynamodb.Table) {
      // Access the underlying CloudFormation resource (L1 construct)
      const cfnTable = node.node.defaultChild as dynamodb.CfnTable;

      // *** CORRECTED CHECK: Check for the existence of the specification property ***
      // If 'pointInTimeRecovery: true' was set on the L2 Table construct,
      // CDK should synthesize the 'pointInTimeRecoverySpecification' property.
      if (cfnTable.pointInTimeRecoverySpecification) {
        // If the specification property exists, assume PITR is enabled and add the tag.
        cfnTable.tags.setTag('PITR-Enabled', 'true'); // Use CfnTable's tag manager
        cdk.Annotations.of(node).addInfo('PITR specification found; Tagged for compliance.');
      } else {
        // If the specification property is absent, PITR is likely disabled. Add error.
        cdk.Annotations.of(node).addError('Compliance Error: DynamoDB Point-in-Time Recovery (PITR) must be enabled in the CDK code! (Set pointInTimeRecovery: true)');
      }
    }
    // Add other compliance checks here if desired
  }
}