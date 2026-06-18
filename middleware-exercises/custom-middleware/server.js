import express from "express";

const port = 5000;

const app = express();

/**
 * Middleware 1: extractUsername
 * Looks for a custom request header called X-Username.
 * If found, attaches its value to req.username so the route handler can use it.
 * If not found, sets req.username to null (meaning "anonymous user").
 */
function extractUsername(req, res, next) {
  req.username = req.headers["x-username"] || null;
  next();
}

/**
 * Middleware 2: parseJsonArrayBody
 *
 * Reads the raw POST body, parses it as JSON, and validates that it is
 * an array containing only strings. If valid, attaches the parsed array
 * to req.body. If invalid, responds with a 400 error and returns
 */
function parseJSONArrayBody(req, res, next) {
  // Collect rawBytes from data as they stream in
  const bodyBytes = [];
  req.on("data", (chunk) => bodyBytes.push(...chunk));

  //   process the entire body once entire data arrives
  req.on("end", () => {
    // convert the body into a readable string
    const bodyString = String.fromCharCode(...bodyBytes);
    // parse the bodyString as JSON, if not valid JSON throw an error and then catch it
    let body;
    try {
      body = JSON.parse(bodyString);
    } catch (error) {
      // catch error from a bad request
      console.error(`Failed to parse body ${bodyString} as JSON: ${error}`);
      res.status(400).send(`Body must be valid JSON.`);
      return;
    }

    // check the parsed body is an array, and not a string, number, or object
    if (!Array.isArray(body)) {
      res.status(400).send(`Body must be a JSON array.`);
      return;
    }

    // check that every element of body the array are strings
    if (!body.every((element) => typeof element === "string")) {
      res.status(400).send(`Body must be a JSON array of strings.`);
      return;
    }
    // Attach body Array to req if all checks passed, to be accessed by route handler
    req.body = body;
    //   move to the next middleware
    next();
  });
}

app.use(extractUsername);
app.use(parseJSONArrayBody);

/**
 * POST /
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
  console.error(`Custom-middleware server listening on port ${port}`),
);