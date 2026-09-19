function requestLogger(req, res, next) {
  console.log("REQUEST:", req.method, req.path);
  next();
}

module.exports = requestLogger;
