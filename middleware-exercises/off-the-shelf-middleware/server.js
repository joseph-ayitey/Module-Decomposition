import express from "express";

const port = 5000;

const app = express();

/**
 * Middleware 1: extractUsername
 * Looks for a custom request header called X-Username.
 * If found, attaches its value to req.username so the route handler can use it.
 * If not found, sets req.username to null (meaning "anonymous user").
 *
 * This middleware is orthogonal to body parsing — it doesn't know or
 * care about the request body. The two middlewares are independent.
 */
function extractUsername(req, res, next) {
  req.username = req.headers["x-username"] || null;
  next();
}
app.use(extractUsername);
/**
 * Middleware 2: express.JSON()
 *
 * Using the builtin JSON parser middleware rather than parseJSONArrayBody
 *
 */
app.use(express.json());

/**
 * Middleware 3: validateJsonArray
 *
 * express.json() doesn't know we specifically need an array of strings —
 * it accepts any valid JSON. This middleware adds that extra validation.
 */
function validateJsonArray(req, res, next) {
  const body = req.body;

  // Checks that the content-type = application/json else will return undefined
  if (!Array.isArray(body)) {
    res
      .status(400)
      .send(
        "Body must be a JSON array. Did you set Content-Type: application/json?",
      );
    return;
  }

  // check that every element of body the array are strings
  if (!body.every((element) => typeof element === "string")) {
    res.status(400).send(`Body must be a JSON array of strings.`);
    return;
  }
  // Validation passed — hand off to the route handler.
  next();
}
app.use(validateJsonArray);

/**
 * POST /
 * 
 * By the time this handler runs, the middlewares have guaranteed:
 *   - req.username is a string (the X-Username header value) or null
 *   - req.body is an array of strings (the parsed POST body)
 *
 * The handler only needs to build the response — all validation is done.
 */
app.post("/", (req, res) => {
  // Authenticate if a username is provided
  const authLine = req.username
    ? `You're authenticated as ${req.username}`
    : `You're not authenticated!`;

  // build subject based on count
  const count = req.body.length;
  let subjectsLine;
  if (count === 0) {
    subjectsLine = `You have requested information about 0 subjects.`;
  } else if (count === 1) {
    // Single subject: no comma-joining needed.
    subjectsLine = `You have requested information about 1 subject: ${req.body[0]}.`;
  } else {
    // Multiple subjects: join the array into a comma-separated list.
    subjectsLine = `You have requested information about ${count} subjects: ${req.body.join(", ")}.`;
  }

  // Send both lines separated by a blank line, with a trailing newline
  res.send(`${authLine}\n\n${subjectsLine}\n`);
});

app.listen(port, () =>
  console.error(`Middleware server listening on port ${port}`),
);