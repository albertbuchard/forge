export type RefreshRotationResult =
  | {
      status: "rotated";
      refreshToken: string;
      familyId: string;
      ownerSecurityEpoch: number;
      clientSecurityEpoch: number;
    }
  | { status: "invalid" }
  | { status: "expired"; familyId: string }
  | { status: "reuse_detected"; familyId: string; clientId: string };

export type RefreshFamilyRepository = {
  issueRefreshFamily(input: {
    clientId: string;
    ownerId: string;
    installationId: string;
    audience: string;
    profile: string;
    keyThumbprint: string;
    scopes: readonly string[];
    ownerSecurityEpoch: number;
    clientSecurityEpoch: number;
  }): { familyId: string; refreshToken: string };
  rotateRefresh(input: {
    refreshToken: string;
    clientId: string;
    installationId: string;
    keyThumbprint: string;
    audience: string;
    afterMarkUsed?: () => void;
  }): RefreshRotationResult;
  revokeRefreshFamily(familyId: string, reason: string): boolean;
};

export class RefreshFamilyService {
  constructor(private readonly repository: RefreshFamilyRepository) {}

  issue(input: Parameters<RefreshFamilyRepository["issueRefreshFamily"]>[0]) {
    return this.repository.issueRefreshFamily(input);
  }

  rotate(input: Parameters<RefreshFamilyRepository["rotateRefresh"]>[0]) {
    return this.repository.rotateRefresh(input);
  }

  revoke(familyId: string, reason: string) {
    return this.repository.revokeRefreshFamily(familyId, reason);
  }
}
