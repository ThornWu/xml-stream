// 检查对象是否为空
const isEmpty = (obj) => Object.keys(obj).length === 0;

// XML 实体字符映射表
const entities = {
  '"': '&quot;',
  '&': '&amp;',
  '\'': '&apos;',
  '<': '&lt;',
  '>': '&gt;'
};

// 转义 XML 特殊字符
const escape = (value) => value.replace(/"|&|'|<|>/g, entity => entities[entity]);

// 规范化选择器字符串
const normalizeSelector = selector => {
  // 使用正则表达式匹配选择器中的各个部分（非空白字符序列或 > 符号）
  const parts = selector.match(/[^\s>]+|>/ig) ?? [];
  const normalized = parts.length ? parts.join(' ') : '';
  return { normalized, parts };
};

// 将形如 endElement:item 的字符串进行规范化处理
const parseEvent = event => {
  // 匹配事件类型和选择器部分
  const eventParts = event.match(/^((?:start|end|update)Element|text):?(.*)/);
  if (!eventParts) {
    return null;
  }

  const [, eventType, selectorStr] = eventParts;
  const selector = normalizeSelector(selectorStr ?? '');

  return {
    selector,
    type: eventType,
    name: selectorStr ? `${eventType}: ${selector.normalized}` : eventType
  };
};


module.exports = {
  isEmpty,
  escape,
  normalizeSelector,
  parseEvent,
};
