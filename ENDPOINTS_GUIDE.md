# 🤖 AIAgentBot - Endpoints Documentation

Complete guide to using the AIAgentBot API with Postman or other HTTP clients.

---

## 📋 Quick Reference

**Base URL**: `http://localhost:3000` (or your deployed URL)

**Authentication**: Most endpoints require `x-api-key` header
- Set via: `API_KEY`, `BOT_API_KEY` environment variable, or default (empty)

**Response Format**: JSON (unless noted otherwise)

---

## 🔐 Authentication

### Add API Key to Requests

In Postman, add to **Headers**:
```
x-api-key: your_api_key_here
```

Or as Environment Variable in Postman:
```
Headers: x-api-key: {{api_key}}
```

**Endpoints that require API Key**: All endpoints except `/`, `/status`, `/logs/stream`

---

## 🖥️ Browser Control Endpoints

### 1. Screenshot
```
GET /screenshot
```
**Authentication**: ❌ Not Required
**Response**: JPEG image

**Postman Setup**:
- Method: GET
- URL: `http://localhost:3000/screenshot`
- Send → Image preview will show

**Use Case**: Capture current state of browser

---

### 2. Get Current URL
```
GET /browser/url
```
**Authentication**: ❌ Not Required

**Response**:
```json
{
  "url": "https://example.com"
}
```

---

### 3. Navigate to URL
```
POST /browser/navigate
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "url": "https://www.example.com"
}
```

**Response**:
```json
{
  "ok": true,
  "url": "https://www.example.com"
}
```

**Postman Setup**:
- Method: POST
- URL: `http://localhost:3000/browser/navigate`
- Body → raw → JSON
- Content: `{"url": "https://www.example.com"}`

---

### 4. Click at Coordinates
```
POST /browser/click
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "x": 640,
  "y": 360,
  "button": "left"
}
```

**Parameters**:
- `x`, `y` (required): Pixel coordinates
- `button`: "left", "right", or "middle" (default: "left")

---

### 5. Type Text
```
POST /browser/type
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "text": "Hello World",
  "delay": 30
}
```

**Parameters**:
- `text` (required): Text to type
- `delay`: Milliseconds between keystrokes (default: 30)

---

### 6. Press Keyboard Key
```
POST /browser/keypress
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "key": "Enter"
}
```

**Common Keys**: `Enter`, `Tab`, `Escape`, `ArrowUp`, `ArrowDown`, `Delete`, `Backspace`

---

### 7. Scroll Page
```
POST /browser/scroll
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "x": 640,
  "y": 360,
  "deltaX": 0,
  "deltaY": 300
}
```

**Parameters**:
- `x`, `y`: Position to scroll from (default: center)
- `deltaX`, `deltaY`: Scroll distance (positive = down/right)

---

### 8. Copy Text from Element
```
POST /browser/copy
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "selector": "h1"
}
```

**Response**:
```json
{
  "ok": true,
  "text": "Page Title"
}
```

**Postman Setup**:
- Method: POST
- URL: `http://localhost:3000/browser/copy`
- Body: `{"selector": "button.submit"}`

---

### 9. Read Text from Element or Position
```
POST /browser/read
```
**Authentication**: ❌ Not Required

**Body (Option 1 - By Selector)** (JSON):
```json
{
  "selector": ".product-name"
}
```

**Body (Option 2 - By Position)** (JSON):
```json
{
  "x": 640,
  "y": 360
}
```

**Response**:
```json
{
  "ok": true,
  "text": "Product Name"
}
```

---

### 10. Wait for Element or Time
```
POST /browser/wait
```
**Authentication**: ❌ Not Required

**Body (Option 1 - Wait for Selector)** (JSON):
```json
{
  "selector": ".loading-complete",
  "timeout": 30000
}
```

**Body (Option 2 - Wait for Time)** (JSON):
```json
{
  "ms": 2000
}
```

---

### 11. Send Text and Press Enter
```
POST /browser/send
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "selector": "input[type=search]",
  "text": "query",
  "pressEnter": true
}
```

**Parameters**:
- `selector` (optional): Element to click and type in
- `text` (optional): Text to type
- `pressEnter` (optional): Press Enter after typing (default: true)

---

### 12. Execute JavaScript
```
POST /browser/evaluate
```
**Authentication**: ❌ Not Required

**Body** (JSON):
```json
{
  "script": "return document.title;"
}
```

**Response**:
```json
{
  "ok": true,
  "result": "Page Title"
}
```

**Advanced Example**:
```json
{
  "script": "return { links: document.querySelectorAll('a').length, title: document.title }"
}
```

---

## 📁 Profile Management Endpoints

### 13. Get All Profiles
```
GET /profiles
```
**Authentication**: ❌ Not Required

**Response**:
```json
[
  {
    "slug": "deepseek-send",
    "name": "DeepSeek Send",
    "url": "https://chat.deepseek.com",
    "steps": [...]
  }
]
```

---

### 14. Create/Update Profile
```
POST /profiles
```
**Authentication**: ✅ Required

**Body** (JSON):
```json
{
  "name": "My Bot Profile",
  "url": "https://example.com",
  "label": "My Custom Bot",
  "workflowMode": "js",
  "scriptSource": "provider",
  "provider": "deepseek",
  "command": "prompt",
  "steps": []
}
```

**Custom JS Example**:
```json
{
  "name": "My JS Profile",
  "url": "https://chat.deepseek.com",
  "workflowMode": "js",
  "scriptSource": "custom",
  "script": "async function run(context) { const { page, message } = context; return { success: true, result: message }; }"
}
```

**Step Actions**:
- `navigate`: Go to URL
- `click`: Click element or coordinates
- `type`: Type text
- `send`: Type and press Enter
- `keypress`: Press key
- `scroll`: Scroll page
- `read`: Read text from element
- `wait`: Wait for element or time
- `evaluate`: Run JavaScript

**JS Mode Profile Properties**:
- `workflowMode`: `touch` or `js`
- `scriptSource`: `provider` or `custom`
- `provider`: Provider key for built-in scripts (e.g. `deepseek`)
- `command`: Provider command name (e.g. `prompt`, `login`)
- `script`: Custom JS code when `scriptSource` is `custom`

---

### 15. Delete Profile
```
DELETE /profiles/:name
```
**Authentication**: ✅ Required

**URL**: `DELETE /profiles/My%20Bot%20Profile`

**Response**:
```json
{
  "ok": true,
  "deleted": "My Bot Profile"
}
```

---

## 🚀 Execution Endpoints

### 16. Run Profile with Prompt
```
POST /run
```
**Authentication**: ✅ Required

**Body** (JSON):
```json
{
  "profile": "DeepSeek Send",
  "prompt": "What is 2+2?"
}
```

**Response**:
```json
{
  "ok": true
}
```

**Note**: Use `/logs/stream` SSE endpoint to get real-time updates

> Profiles saved with `workflowMode: "js"` and `scriptSource: "provider"` will execute a provider command script. Profiles saved with `scriptSource: "custom"` will execute the custom JS code stored in `script`.

---

### 17. Run Profile by Slug (POST)
```
POST /run/:slug
```
**Authentication**: ✅ Required

**URL**: `POST /run/deepseek-send`

**Body** (JSON):
```json
{
  "prompt": "What is the weather?"
}
```

**Response**:
```json
{
  "ok": true,
  "reply": "The response from the bot"
}
```

**Postman Setup**:
- Method: POST
- URL: `http://localhost:3000/run/deepseek-send`
- Headers: `x-api-key: your_key`
- Body: `{"prompt": "Your question here"}`

---

### 18. Run Profile by Slug (GET)
```
GET /run/:slug?prompt=...
```
**Authentication**: ✅ Required

**URL**: `GET /run/deepseek-send?prompt=Hello%20world`

**Response**:
```json
{
  "ok": true,
  "reply": "Response from bot"
}
```

**Postman Setup**:
- Method: GET
- URL: `http://localhost:3000/run/deepseek-send?prompt=Hello`
- Headers: `x-api-key: your_key`

---

### 19. Execute Direct JS
```
POST /execute-js-direct
```
**Authentication**: ✅ Required

**Body** (provider mode):
```json
{
  "runMode": "provider",
  "script": "",
  "context": {
    "provider": "deepseek",
    "command": "prompt",
    "prompt": "Hello from direct JS mode",
    "credentials": {
      "email": "user@example.com",
      "password": "secret",
      "apiKey": ""
    }
  }
}
```

**Body** (custom JS mode):
```json
{
  "runMode": "custom",
  "script": "async function run(context) { return { success: true, prompt: context.prompt }; }",
  "context": {
    "prompt": "Hello from custom JS mode",
    "credentials": {
      "email": "",
      "password": "",
      "apiKey": ""
    }
  }
}
```

**Response**:
```json
{
  "ok": true,
  "result": { ... }
}
```

**Notes**:
- `runMode` must be `provider` or `custom`
- `prompt` is available in `context.prompt`
- `provider` and `command` are required for provider-based execution
- Add `"useUi": true` to execute through the local builder UI instead of running directly on the provider page

---

### 20. Execute JS through App UI
```
POST /execute-js-ui
```
**Authentication**: ✅ Required

**Body** (provider mode):
```json
{
  "runMode": "provider",
  "context": {
    "provider": "deepseek",
    "command": "prompt",
    "prompt": "Hello from remote UI",
    "credentials": {
      "email": "user@example.com",
      "password": "secret",
      "apiKey": ""
    }
  }
}
```

**Body** (custom JS mode):
```json
{
  "runMode": "custom",
  "script": "async function run(context) { return { success: true, prompt: context.prompt }; }",
  "context": {
    "prompt": "Hello from remote UI",
    "credentials": {
      "email": "",
      "password": "",
      "apiKey": ""
    }
  }
}
```

**Response**:
```json
{
  "ok": true,
  "result": "...captured UI builder output..."
}
```

**Use case**: remote UI control that selects provider and command dropdowns in the app, clicks the execute button, and returns the output from the builder response box.

---

### 20. Stop Current Execution
```
POST /stop
```
**Authentication**: ✅ Required

**Body**: `{}` (empty)

**Response**:
```json
{
  "ok": true
}
```

---

### 21. Ask Bot Question
```
POST /ask
```
**Authentication**: ✅ Required

**Body** (JSON):
```json
{
  "message": "What is the capital of France?",
  "profile": "DeepSeek Send"
}
```

**Response**:
```json
{
  "reply": "The capital of France is Paris."
}
```

---

## 📊 System Endpoints

### 22. Server Status
```
GET /status
```
**Authentication**: ❌ Not Required

**Response**:
```json
{
  "running": false,
  "url": "https://example.com",
  "browserConnected": true
}
```

**Use Case**: Health check, verify server is alive

---

### 22. Get Endpoints List
```
GET /endpoints
```
**Authentication**: ✅ Required

**Response**:
```json
{
  "endpoints": [
    {
      "name": "DeepSeek Send",
      "slug": "deepseek-send",
      "endpoint": "/run/deepseek-send",
      "description": "Send messages to DeepSeek",
      "url": "https://chat.deepseek.com"
    }
  ],
  "docs": {
    "run": "POST /run/{slug} with {\"prompt\":\"...\"}",
    "runGet": "GET /run/{slug}?prompt=..."
  }
}
```

---

### 23. Get Execution History
```
GET /history?limit=20
```
**Authentication**: ✅ Required

**Query Parameters**:
- `limit`: Max results (1-100, default: 20)

**Response**:
```json
[
  {
    "id": 1,
    "profile_slug": "deepseek-send",
    "profile_name": "DeepSeek Send",
    "prompt": "What is 2+2?",
    "result": "2+2 equals 4",
    "status": "success",
    "error": null,
    "duration_ms": 5234,
    "created_at": "2026-05-18T19:48:00Z"
  }
]
```

**Note**: Requires `DATABASE_URL` environment variable

---

### 24. Documentation Page
```
GET /docs
```
**Authentication**: ❌ Not Required

**Response**: HTML page with interactive documentation

---

### 25. Server-Sent Events (SSE) - Logs Stream
```
GET /logs/stream
```
**Authentication**: ❌ Not Required

**Response**: Event stream

**Message Types**:
```
data: {"type":"connected"}
data: {"type":"log","message":"...","level":"info","time":"2026-05-18T..."}
data: {"type":"done","result":"..."}
data: {"type":"error","message":"..."}
```

**Postman Setup** (not ideal for SSE, use curl instead):
```bash
curl -N http://localhost:3000/logs/stream
```

---

## 📝 Complete Postman Collection Example

### Setup Environment Variable
```
api_key = your_api_key_here
base_url = http://localhost:3000
```

### Request 1: Navigate
```
POST {{base_url}}/browser/navigate
Headers: x-api-key: {{api_key}}
Body: {"url": "https://chat.deepseek.com"}
```

### Request 2: Type Query
```
POST {{base_url}}/browser/type
Body: {"text": "How does photosynthesis work?", "delay": 50}
```

### Request 3: Press Enter
```
POST {{base_url}}/browser/keypress
Body: {"key": "Enter"}
```

### Request 4: Wait for Response
```
POST {{base_url}}/browser/wait
Body: {"selector": ".message-response", "timeout": 30000}
```

### Request 5: Read Answer
```
POST {{base_url}}/browser/read
Body: {"selector": ".message-response"}
```

### Request 6: Take Screenshot
```
GET {{base_url}}/screenshot
```

---

## 🛠️ Common Workflows

### Workflow 1: Search Google
```
1. POST /browser/navigate → {"url": "https://google.com"}
2. POST /browser/click → {"x": 400, "y": 400}  // Click search box
3. POST /browser/type → {"text": "nodejs"}
4. POST /browser/keypress → {"key": "Enter"}
5. POST /browser/wait → {"selector": "div.g"}  // Wait for results
6. POST /browser/read → {"selector": "div.g"}  // Read first result
7. GET /screenshot → Get screenshot
```

### Workflow 2: Run Saved Profile
```
1. GET /profiles → Get available profiles
2. POST /run/my-profile → {"prompt": "Your question"}
3. GET /logs/stream → Watch real-time execution
4. Wait for result...
5. GET /history → Review execution
```

### Workflow 3: Custom JavaScript Execution
```
POST /browser/evaluate
Body: {
  "script": "return {
    links: Array.from(document.querySelectorAll('a')).map(a => a.href),
    title: document.title,
    wordCount: document.body.innerText.split(/\s+/).length
  }"
}
```

---

## ⚠️ Error Responses

All errors return JSON:

```json
{
  "error": "Error message here"
}
```

**Common Status Codes**:
- `200`: Success
- `400`: Bad request (missing parameters)
- `409`: Conflict (bot already running)
- `500`: Server error

---

## 🔄 Environment Variables

```bash
# Port
PORT=3000

# API Authentication
API_KEY=your_secret_key
BOT_API_KEY=alternative_key_name

# Browser
PUPPETEER_EXECUTABLE_PATH=/path/to/chromium
CHROME_BIN=/usr/bin/chromium

# Database (optional)
DATABASE_URL=postgres://user:pass@host:5432/db

# Self-Pinger
PING_INTERVAL=300000  # 5 minutes in milliseconds
```

---

## 📞 Tips for Postman

1. **Save Base URL as Variable**:
   - Settings → Variables
   - `base_url: http://localhost:3000`
   - Use as `{{base_url}}`

2. **Pre-request Script for Screenshots**:
   - Add `Content-Type: image/jpeg` header

3. **Tests for Validations**:
   ```javascript
   pm.test("Status is 200", function() {
     pm.response.to.have.status(200);
   });
   ```

4. **Create Scenarios with Runner**:
   - Save requests in a collection
   - Use Collection Runner for workflows

---

## 🐛 Debugging

**Check Server Logs**:
```bash
# Real-time logs
curl -N http://localhost:3000/logs/stream

# Or check via SSE in browser console
const es = new EventSource('/logs/stream');
es.onmessage = e => console.log(JSON.parse(e.data));
```

**Test Connection**:
```bash
curl http://localhost:3000/status
```

**Test with API Key**:
```bash
curl -H "x-api-key: your_key" http://localhost:3000/endpoints
```

---

## 📚 Related Files

- `server.js` - Main server code
- `profiles.json` - Saved profiles
- `Dockerfile` - Deployment configuration
- `package.json` - Dependencies

---

**Last Updated**: May 18, 2026
**Version**: 1.0
