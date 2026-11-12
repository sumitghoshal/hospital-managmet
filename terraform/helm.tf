# Ingress controller (ALB), ExternalDNS (Route 53 records), ArgoCD (GitOps)

resource "helm_release" "aws_lbc" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }
  set {
    name  = "region"
    value = var.region
  }
  set {
    name  = "vpcId"
    value = module.vpc.vpc_id
  }
  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  depends_on = [module.eks, module.lb_controller_identity]
}

resource "helm_release" "external_dns" {
  name       = "external-dns"
  namespace  = "kube-system"
  repository = "https://kubernetes-sigs.github.io/external-dns/"
  chart      = "external-dns"

  set {
    name  = "provider.name"
    value = "aws"
  }
  set {
    name  = "serviceAccount.name"
    value = "external-dns"
  }
  set {
    name  = "domainFilters[0]"
    value = var.domain_name
  }
  set {
    name  = "txtOwnerId"
    value = var.project
  }
  set {
    name  = "policy"
    value = "sync"
  }

  depends_on = [module.eks, module.external_dns_identity]
}

resource "helm_release" "argocd" {
  name             = "argocd"
  namespace        = "argocd"
  create_namespace = true
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"

  depends_on = [module.eks, helm_release.aws_lbc]
}
