process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/db'
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'testsecret'
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'
process.env.ENABLE_MCP_INSTALL = process.env.ENABLE_MCP_INSTALL || '1'
