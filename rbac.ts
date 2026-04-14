import * as crypto from "crypto";
import * as pulumi from "@pulumi/pulumi";
import * as authorization from "@pulumi/azure-native/authorization";

const aksClusterAdminRoleDefinitionId = "0ab0b1a8-8aac-4efd-b8c2-3ee1fb270be8";
const aksClusterUserRoleDefinitionId = "4abbcc35-e782-43d8-92c5-2d3f1bd2253f";
const readerRoleDefinitionId = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const acrPullRoleDefinitionId = "7f951dda-4ed3-4680-a7ca-43fe172d538d";

function deterministicGuid(seed: string): string {
  const hash = crypto.createHash("md5").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function roleDefinitionId(scope: pulumi.Input<string>, roleId: string): pulumi.Output<string> {
  return pulumi.output(scope).apply((scopeId) => `${scopeId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`);
}

export function configureRbac(args: {
  resourceGroupId: pulumi.Input<string>;
  aksClusterId: pulumi.Input<string>;
  aksKubeletObjectId: pulumi.Input<string>;
  namespaces: string[];
  opcoPlatformGroupObjectId: string;
  opcoReadOnlyGroupObjectId: string;
  namespaceUserGroupObjectIds: Record<string, string>;
  hubAcrResourceId: pulumi.Input<string>;
}): void {
  new authorization.RoleAssignment("ra-telco-aks-cluster-admin", {
    principalId: args.opcoPlatformGroupObjectId,
    principalType: "Group",
    scope: args.aksClusterId,
    roleDefinitionId: roleDefinitionId(args.aksClusterId, aksClusterAdminRoleDefinitionId),
    roleAssignmentName: deterministicGuid("telco-aks-cluster-admin"),
  });

  new authorization.RoleAssignment("ra-telco-rg-reader", {
    principalId: args.opcoReadOnlyGroupObjectId,
    principalType: "Group",
    scope: args.resourceGroupId,
    roleDefinitionId: roleDefinitionId(args.resourceGroupId, readerRoleDefinitionId),
    roleAssignmentName: deterministicGuid("telco-rg-reader"),
  });

  for (const namespace of args.namespaces) {
    const namespaceGroupId = args.namespaceUserGroupObjectIds[namespace] ?? "33333333-3333-3333-3333-333333333333";

    new authorization.RoleAssignment(`ra-${namespace}-aks-user`, {
      principalId: namespaceGroupId,
      principalType: "Group",
      scope: args.aksClusterId,
      roleDefinitionId: roleDefinitionId(args.aksClusterId, aksClusterUserRoleDefinitionId),
      roleAssignmentName: deterministicGuid(`telco-${namespace}-aks-user`),
    });
  }

  new authorization.RoleAssignment("ra-telco-kubelet-acrpull", {
    principalId: args.aksKubeletObjectId,
    principalType: "ServicePrincipal",
    scope: args.hubAcrResourceId,
    roleDefinitionId: roleDefinitionId(args.hubAcrResourceId, acrPullRoleDefinitionId),
    roleAssignmentName: deterministicGuid("telco-kubelet-acrpull"),
  });
}
