// lib/tagging-aspect.ts (Revert to L2 Tagging API)
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

export class BasicTagger implements cdk.IAspect {
  private readonly key: string;
  private readonly value: string;
  constructor(key: string, value: string | undefined) { // Allow undefined from tryGetContext
    this.key = key;
    // Ensure we have a string value, even if context lookup failed.
    // An empty tag value might still cause issues depending on SCPs, but avoids runtime errors here.
    this.value = value ?? '';
    if (value === undefined || value === null) {
       // Add a warning during synthesis if the context value was missing
       // Note: This might appear multiple times if aspect visits many nodes
       console.warn(`BasicTagger: Value for tag key '${key}' was undefined or null.`);
    }
  }

  public visit(node: IConstruct): void {
    // Use the standard L2 Tags API.
    // Check if the construct is taggable first.
    if (cdk.TagManager.isTaggable(node)) {
      // Use the L2 setTag method (equivalent to Tags.of(node).add)
      node.tags.setTag(this.key, this.value);
    }
  }
}