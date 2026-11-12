output "certificate_arn" { value = aws_acm_certificate.app.arn }
output "app_url"              { value = "https://${local.host}" }
output "route53_nameservers"  { value = local.nameservers }
output "ecr_repository_url"   { value = aws_ecr_repository.app.repository_url }
output "github_actions_role_arn" { value = aws_iam_role.github_actions.arn }
output "kubeconfig_command"   { value = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}" }
output "argocd_password_command" { value = "kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d" }
