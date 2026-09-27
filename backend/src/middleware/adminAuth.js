const jwt = require("jsonwebtoken");

const ADMIN_ISSUER = "feedants-admin";
const ADMIN_AUDIENCE = "feedants-admin-api";

function getJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  return secret;
}

function requireAdmin(req, res, next) {
  const secret = getJwtSecret();
  if (!secret) {
    return res.status(503).json({
      message: "Admin authentication is not configured.",
    });
  }

  const authorization = req.get("authorization") || "";
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token || extra.length > 0) {
    return res.status(401).json({
      message: "A valid Bearer token is required.",
    });
  }

  try {
    req.admin = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: ADMIN_ISSUER,
      audience: ADMIN_AUDIENCE,
    });
    return next();
  } catch (error) {
    return res.status(401).json({
      message: "The admin token is invalid or expired.",
    });
  }
}

module.exports = {
  ADMIN_AUDIENCE,
  ADMIN_ISSUER,
  getJwtSecret,
  requireAdmin,
};
