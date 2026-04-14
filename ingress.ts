import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

function keyVaultNameFromUri(uri: string): string {
  return uri.replace("https://", "").split(".")[0];
}

export function deployIngress(args: {
  provider: k8s.Provider;
  keyVaultUri: pulumi.Input<string>;
}): void {
  new k8s.helm.v3.Release(
    "ingress-nginx",
    {
      chart: "ingress-nginx",
      repositoryOpts: { repo: "https://kubernetes.github.io/ingress-nginx" },
      namespace: "ingress-nginx",
      createNamespace: true,
      values: {
        controller: {
          service: {
            annotations: {
              "service.beta.kubernetes.io/azure-load-balancer-internal": "true",
            },
          },
        },
      },
    },
    { provider: args.provider },
  );

  new k8s.apiextensions.CustomResource(
    "ingress-nginx-tls-spc",
    {
      apiVersion: "secrets-store.csi.x-k8s.io/v1",
      kind: "SecretProviderClass",
      metadata: {
        name: "ingress-tls-kv",
        namespace: "ingress-nginx",
      },
      spec: {
        provider: "azure",
        parameters: {
          usePodIdentity: "false",
          useVMManagedIdentity: "true",
          keyvaultName: pulumi.output(args.keyVaultUri).apply(keyVaultNameFromUri),
          tenantId: "00000000-0000-0000-0000-000000000000",
          objects: "array: []",
        },
        secretObjects: [
          {
            secretName: "ingress-nginx-tls",
            type: "kubernetes.io/tls",
            data: [
              { objectName: "tls-cert", key: "tls.crt" },
              { objectName: "tls-key", key: "tls.key" },
            ],
          },
        ],
      },
    },
    { provider: args.provider },
  );
}
