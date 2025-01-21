const events = require('events');
const expat = require('node-expat');
const FiniteAutomata = require('./finite-automata');
const Iconv = require('iconv').Iconv;
const utils = require('./utils');

// Parser events to finite automata events mapping.
var faModes = {
  'startElement': 'enter',
  'endElement': 'leave',
  'text': 'state'
};

// JiraXmlStream is the base class for XML stream processing
class JiraXmlStream extends events.EventEmitter {
  constructor(stream) {
    super();
    this._stream = stream;
    this._fa = new FiniteAutomata();
    this._encoder = new Iconv('utf8', 'utf8');
    this._parser = new expat.Parser('utf-8');
    this._lastState = 0;
    this._startState = {};
    this._finalStates = {};
    this._emitData = false;
    this._bufferLevel = 0;
    this._preserveLevel = 0;
    this._preserveWhitespace = 0;
    this._preserveAll = false;
    this._collect = false;
    this._suspended = false;

    // Start parsing.
    process.nextTick(() => {
      this._parse();
    });
  }

  // Starts parsing the source stream and emitting various events.
  // The Expat parser is assigned several listeners for this purpose.
  _parse() {
    const xml = this._parser;
    const stack = [];
    const trace = {};
    let curr = {
      element: {},
      collect: this._collect,
      fullText: '',
      space: 0,
      path: '',
      context: {}
    };
    const fa = this._fa;
    fa.setState(this._startState);

    // A listener is assigned on opening tag encounter.
    xml.on('startElement', (name, attr) => {
      this.emit('startElement', name, attr);
      stack.push(curr);
      trace[curr.path] = curr.element;
      const context = Object.create(curr.context);
      const element = {
        $: attr,
        $name: name,
        $text: ''
      };
      const { element: parent } = curr;
      curr = {
        element,
        collect: false,
        fullText: '',
        space: 0,
        path: `${curr.path}/${name}`,
        context
      };
      this._collect = false;
      fa.enter(name, [element, context, trace]);
      this._preserveLevel > 0 && (element.$children = []);
      name = element.$name;
      curr.collect = this._collect;
      if (curr.collect) {
        if (Object.hasOwn(parent, name)) {
          parent[name].push(element);
        } else {
          parent[name] = [element];
        }
      } else {
        parent[name] = element;
        context[name] = element;
      }
      this._bufferLevel === 0 && this._emitData && this._emitStart(name, element.$);
    });

    // A listener is assigned on closing tag encounter.
    xml.on('endElement', (name) => {
      this.emit('endElement', name);
      const prev = stack.pop();
      const { element, fullText: text, context } = curr;
      const attr = element.$ ?? {};
      const elementName = element.$name;
      this._name = elementName;
      delete element.$;
      delete element.$text;
      delete element.$name;
      let val = element;
      if (utils.isEmpty(element) && utils.isEmpty(attr)) {
        val = text;
      } else if (!utils.isEmpty(attr)) {
        element.$ = attr;
      }
      text !== '' && (element.$text = text);
      (this._bufferLevel > 0 || this._preserveLevel > 0) && (element.$name = elementName);
      context[elementName] = val;
      if (curr.collect) {
        const container = prev.element[elementName];
        container[container.length - 1] = val;
      } else {
        prev.element[elementName] = val;
      }
      fa.leave([element, context, trace]);
      this._preserveLevel > 0 && prev.element.$children.push(val);
      this._bufferLevel === 0 && this._emitData && this._emitEnd(elementName);
      curr = prev;
      this._collect = curr.collect;
    });

    // Collect node text part by part
    xml.on('text', (text) => {
      curr.element.$text = text;
      fa.run('state', [curr.element, curr.context, trace]);
      this._bufferLevel === 0 && this._emitData && this._emitText(text);
      if (!this._preserveAll) {
        const trimmed = curr.element.$text.trim();
        const spaced = curr.element.$text.substr(0, 1) !== '' && curr.element.$text.substr(0, 1).trim() === '';
        const after = curr.element.$text.substr(-1, 1) !== '' && curr.element.$text.substr(-1, 1).trim() === '';
        switch (curr.space) {
          case 0:
            trimmed !== '' && (curr.space = after ? 2 : 1);
            break;
          case 1:
            if (trimmed === '') {
              curr.space = 2;
            } else {
              spaced && (curr.fullText += ' ');
              after && (curr.space = 2);
            }
            break;
          case 2:
            if (trimmed !== '') {
              curr.fullText += ' ';
              curr.space = 1;
            }
            break;
        }
        text = this._preserveWhitespace > 0 ? text : trimmed;
        this._preserveLevel > 0 && text !== '' && curr.element.$children.push(text);
      }
      curr.fullText += text;
    });

    // Parse incoming chunk.
    // Convert to UTF-8 or emit errors when appropriate.
    this._stream.on('data', (data) => {
      data = this._encoder.convert(data);
      if (!xml.parse(data, false)) {
        this.emit('error', new Error(`${xml.getError()} in line ${xml.getCurrentLineNumber()}`));
      }
    });

    // End parsing on stream EOF and emit an *end* event ourselves.
    this._stream.on('end', () => {
      if (!xml.parse('', true)) {
        this.emit('error', new Error(`${xml.getError()} in line ${xml.getCurrentLineNumber()}`));
      }
      this.emit('end');
    });
  }

  // Emits XML for element opening tag.
  _emitStart(name, attrs) {
    this.emit('data', `<${name}`);
    for (const [attr, value] of Object.entries(attrs)) {
      if (Object.hasOwn(attrs, attr)) {
        this.emit('data', ` ${attr}="${utils.escape(value)}"`);
      }
    }
    this.emit('data', '>');
  }

  // Emits XML for element closing tag.
  _emitEnd(name) {
    this.emit('data', `</${name}>`);
  }

  // Emits XML for element text.
  _emitText(text) {
    this.emit('data', utils.escape(text));
  }

  // Emits child element collection and their descendants.
  // Works only with preserved nodes.
  _emitChildren(elements) {
    elements.forEach(element => {
      if (typeof element === 'object') {
        this._emitStart(element.$name, element.$);
        this._emitChildren(element.$children);
        this._emitEnd(element.$name);
      } else {
        this._emitText(element);
      }
    });
  }

  // Recursively emits a given element and its descendants.
  _emitOneElement(element, name, onLeave) {
    if (typeof element === 'object') {
      this._emitStart(name, element.$);
      if (Object.hasOwn(element, '$children')) {
        this._emitChildren(element.$children);
      } else {
        let hasText = false;
        for (const [child, value] of Object.entries(element)) {
          if (Object.hasOwn(element, child) && child !== '$' && child !== '$name') {
            if (child === '$text') {
              hasText = true;
            } else {
              this._emitElement(value, child);
            }
          }
        }
        hasText && this._emitText(element.$text);
      }
    } else {
      this._emitStart(name, element.$);
      this._emitText(element);
    }
    !onLeave && this._emitEnd(name);
  }

  // Emits a single element and its descendants, or an array of elements.
  _emitElement(element, name, onLeave) {
    if (Array.isArray(element)) {
      const lastIndex = element.length - 1;
      element.forEach((el, index) => {
        this._emitOneElement(el, name, index === lastIndex && onLeave);
      });
    } else {
      this._emitOneElement(element, name, onLeave);
    }
  }

  // Compiles a given selector object to a finite automata
  // and returns its last state.
  _getFinalState(selector) {
    const { normalized, parts } = selector;
    const finalState = this._finalStates[normalized] ?? (() => {
      const n = parts.length;
      let immediate = false;
      this._startState[this._lastState] = true;

      for (let i = 0; i < n; i++) {
        const part = parts[i];
        if (part === '>') {
          immediate = true;
        } else {
          if (!immediate) {
            this._fa.transition(this._lastState, '', this._lastState);
          }
          this._fa.transition(this._lastState, part, ++this._lastState);
          immediate = false;
        }
      }

      const newFinalState = this._lastState++;
      this._finalStates[normalized] = newFinalState;
      return newFinalState;
    })();

    return finalState;
  }

  // Adds a listener for the specified event.
  on(eventName, listener) {
    const event = utils.parseEvent(eventName);
    if (event !== null) {
      // If we're dealing with a selector event,
      // continue with selector-specific processing logic.
      super.on(event.name, listener);
      const finalState = this._getFinalState(event.selector);

      if (event.type === 'updateElement') {
        this._fa.on('enter', finalState, () => {
          this._bufferLevel++;
        });
        this._fa.on('leave', finalState, (element, context, trace) => {
          this.emit(event.name, element, context, trace);
          if (!--this._bufferLevel && this._emitData) {
            this._emitElement(element, this._name, true);
          }
        });
      } else {
        this._fa.on(faModes[event.type], finalState, (element, context, trace) => {
          this.emit(event.name, element, context, trace);
        });
      }
    } else {
      // Otherwise, we're dealing with a non-selector event.
      if (eventName === 'data') {
        this._emitData = true;
      }
      super.on(eventName, listener);
    }

    return this;
  }

  // Collects elements with identical names, specified by a selector.
  collect(selector) {
    selector = utils.normalizeSelector(selector);
    const finalState = this._getFinalState(selector);

    this._fa.on('flag', finalState, () => {
      this._collect = true;
    });

    return this;
  }

  // 保持 xml 元素的顺序，如元素和子元素
  preserve(selector, whitespace) {
    selector = utils.normalizeSelector(selector);
    const finalState = this._getFinalState(selector);

    this._fa.on('enter', finalState, () => {
      this._preserveLevel++;
      whitespace && this._preserveWhitespace++;
    });

    this._fa.on('leave', finalState, () => {
      this._preserveLevel--;
      whitespace && this._preserveWhitespace--;
    });

    return this;
  }

  // 暂停解析
  pause() {
    this._stream.pause();
    this._suspended = true;
    this._parser.pause();
    return this;
  }

  // 继续解析
  resume() {
    this._suspended = false;
    this._parser.resume();
    !this._suspended && this._stream.resume();
    return this;
  }
}

module.exports = JiraXmlStream;
