module.exports = {
  MTIME: 1 << 0,
  SIZE: 1 << 1,
  has(value, enumValue) {
    return (value & enumValue) == enumValue;
  },
}
