const { format } = require("util");

module.exports = {
  INVALID_CHARACTERS: '路径不能包含下列字符\\/:*?"<>|',
  RESERVED_NAME: (name) => format("%s为操作系统保留字", name),
  EMPTY_NAME: "名称不能是空的",
  MAX_LENGTH: (max) =>format("最大长度为%s", max),
  TRAILING_SPACE: "不能以空格结尾",
  PATH_LENGTH: (max) => format("路径不能长度不能超过%s", max),
};
