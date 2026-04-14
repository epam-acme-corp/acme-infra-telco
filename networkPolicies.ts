import * as k8s from "@pulumi/kubernetes";

export function configureNetworkPolicies(args: {
  provider: k8s.Provider;
  namespaces: string[];
  databasePrivateEndpointCidrs: string[];
  databaseEgressPorts: number[];
  hubFirewallPrivateIp: string;
}): void {
  for (const namespace of args.namespaces) {
    new k8s.networking.v1.NetworkPolicy(
      `${namespace}-default-deny`,
      {
        metadata: { name: "default-deny", namespace },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress", "Egress"],
        },
      },
      { provider: args.provider },
    );

    new k8s.networking.v1.NetworkPolicy(
      `${namespace}-allow-ingress-nginx`,
      {
        metadata: { name: "allow-ingress-nginx", namespace },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress"],
          ingress: [
            {
              from: [
                {
                  namespaceSelector: {
                    matchLabels: {
                      "kubernetes.io/metadata.name": "ingress-nginx",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      { provider: args.provider },
    );

    new k8s.networking.v1.NetworkPolicy(
      `${namespace}-allow-egress-platform`,
      {
        metadata: { name: "allow-egress-platform", namespace },
        spec: {
          podSelector: {},
          policyTypes: ["Egress"],
          egress: [
            {
              to: [
                {
                  namespaceSelector: {
                    matchLabels: {
                      "kubernetes.io/metadata.name": "kube-system",
                    },
                  },
                  podSelector: {
                    matchLabels: {
                      "k8s-app": "kube-dns",
                    },
                  },
                },
              ],
              ports: [
                { protocol: "UDP", port: 53 },
                { protocol: "TCP", port: 53 },
              ],
            },
            ...args.databasePrivateEndpointCidrs.map((cidr) => ({
              to: [{ ipBlock: { cidr } }],
              ports: args.databaseEgressPorts.map((port) => ({ protocol: "TCP", port })),
            })),
            {
              to: [{ ipBlock: { cidr: `${args.hubFirewallPrivateIp}/32` } }],
              ports: [{ protocol: "TCP", port: 443 }],
            },
          ],
        },
      },
      { provider: args.provider },
    );
  }
}
