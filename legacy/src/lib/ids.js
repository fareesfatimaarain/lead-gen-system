const { randomUUID } = require("crypto");

function newId(prefix) {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

module.exports = { newId };
