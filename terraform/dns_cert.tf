# Public hosted zone for the domain (or reuse an existing one).
resource "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.domain_name
}

data "aws_route53_zone" "existing" {
  count        = var.create_hosted_zone ? 0 : 1
  name         = var.domain_name
  private_zone = false
}

locals {
  zone_id     = var.create_hosted_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
  zone_arn    = "arn:aws:route53:::hostedzone/${local.zone_id}"
  nameservers = var.create_hosted_zone ? aws_route53_zone.main[0].name_servers : data.aws_route53_zone.existing[0].name_servers
}

resource "aws_acm_certificate" "app" {
  domain_name       = local.host
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = { for o in aws_acm_certificate.app.domain_validation_options : o.domain_name => o }

  zone_id         = local.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

# Fails after 20 min (instead of 75) if the registrar nameservers are not pointing to Route 53 yet.
resource "aws_acm_certificate_validation" "app" {
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
  timeouts { create = "20m" }
}
