variable "region"       { default = "ap-southeast-2" }
variable "project"      { default = "hms" }
variable "domain_name"  { default = "sumitops.online" }
variable "app_subdomain" {
  description = "App host = <subdomain>.<domain>. Use \"\" to serve on the bare domain."
  default     = "hms"
}
variable "create_hosted_zone" {
  description = "false if sumitops.online ALREADY has a public hosted zone in this AWS account (avoids a second zone with different nameservers)"
  default     = true
}
variable "github_repo"  { description = "owner/repo, e.g. sumit/hospital-management" }
variable "k8s_version"  { default = "1.32" }
variable "public_api_endpoint" {
  description = "Keep EKS API reachable from your laptop/CI. Set false for a fully private control plane (needs VPN/bastion)."
  default     = true
}
