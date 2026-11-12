# EKS Pod Identity: IAM role <-> (namespace, serviceaccount). No OIDC annotations needed.

module "lb_controller_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 1.7"
  name    = "${var.project}-aws-lbc"

  attach_aws_lb_controller_policy = true
  associations = {
    lbc = { cluster_name = module.eks.cluster_name, namespace = "kube-system", service_account = "aws-load-balancer-controller" }
  }
}

module "external_dns_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 1.7"
  name    = "${var.project}-external-dns"

  attach_external_dns_policy    = true
  external_dns_hosted_zone_arns = [local.zone_arn]
  associations = {
    dns = { cluster_name = module.eks.cluster_name, namespace = "kube-system", service_account = "external-dns" }
  }
}

module "ebs_csi_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 1.7"
  name    = "${var.project}-ebs-csi"

  attach_aws_ebs_csi_policy = true
  associations = {
    ebs = { cluster_name = module.eks.cluster_name, namespace = "kube-system", service_account = "ebs-csi-controller-sa" }
  }
}

# Application identity: hms/hms-app can write lab-report files to S3 (least privilege)
resource "aws_s3_bucket" "reports" {
  bucket_prefix = "${var.project}-lab-reports-"
}
resource "aws_s3_bucket_public_access_block" "reports" {
  bucket                  = aws_s3_bucket.reports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

module "app_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 1.7"
  name    = "${var.project}-app"

  additional_policy_arns = { s3 = aws_iam_policy.app_s3.arn }
  associations = {
    app = { cluster_name = module.eks.cluster_name, namespace = "hms", service_account = "hms-app" }
  }
}

resource "aws_iam_policy" "app_s3" {
  name = "${var.project}-app-s3"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.reports.arn, "${aws_s3_bucket.reports.arn}/*"]
    }]
  })
}
