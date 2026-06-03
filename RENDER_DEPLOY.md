# Render Deployment Guide

## Environment Variables Required in Render Dashboard:

### Required:
- `DATABASE_URL`: Your Neon database connection string (must include `?sslmode=require`)
  - Format: `postgresql://user:pass@host.neon.tech/dbname?sslmode=require`
  
### Recommended:
- `PORT`: 10000 (Render auto-assigns this)
- `NODE_ENV`: production
- `API_KEY`: Your secret key for securing /api/data endpoint (optional but recommended)

## How to Get DATABASE_URL from Neon:

1. Go to [Neon Console](https://console.neon.tech)
2. Select your project
3. Click "Connection Details" 
4. Copy the connection string
5. **Important**: Make sure it ends with `?sslmode=require`
   - If not, append `?sslmode=require` to the end

## Deployment Steps:

1. Push your code to GitHub/GitLab
2. In Render Dashboard:
   - Click "New +" → "Web Service"
   - Connect your repository
   - Set Build Command: `npm install`
   - Set Start Command: `node server.js`
   - Add all environment variables above
   - Choose Docker runtime OR Node runtime
   - Deploy!

## Troubleshooting WebSocket Errors:

If you see "fetch failed" or WebSocket errors:

1. Verify DATABASE_URL includes `?sslmode=require`
2. Check that your Neon project allows connections from all IPs (or add Render's IPs)
3. Ensure you're using the latest @neondatabase/serverless package
4. The code now includes fallback to standard pg client if Neon fails

## Instance Type Recommendation:
- Minimum: Free tier works for testing
- Production: Starter ($7/mo) or higher for better performance

## Health Check Endpoint:
- `/status` - Returns server health and database connection status
