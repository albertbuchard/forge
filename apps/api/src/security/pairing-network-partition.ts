declare const verifiedNetworkPartitionBrand: unique symbol;

export type VerifiedNetworkPartition = {
  readonly material: string;
  readonly [verifiedNetworkPartitionBrand]: true;
};

/**
 * The gateway owns this resolver. Routes pass transport metadata, never a
 * client-supplied rate-limit key or network label.
 */
export class PairingNetworkPartitionAuthority<ServerContext> {
  private readonly unusedPartitions = new WeakSet<object>();

  constructor(
    private readonly resolveFromServerContext: (
      context: ServerContext
    ) => string
  ) {}

  observe(context: ServerContext) {
    const material = this.resolveFromServerContext(context).trim();
    if (
      material.length === 0 ||
      material.length > 256 ||
      material.includes("\0")
    ) {
      throw new Error(
        "Forge pairing gateway could not derive a bounded network partition."
      );
    }
    const partition = { material } as VerifiedNetworkPartition;
    this.unusedPartitions.add(partition);
    return partition;
  }

  consume(partition: VerifiedNetworkPartition) {
    if (!this.unusedPartitions.delete(partition)) {
      throw new Error(
        "Forge pairing network partition is forged or was already used."
      );
    }
    return partition.material;
  }
}
