class FiniteAutomata {
  constructor() {
    this._states = {};
    this._state = {};
    this._callbacks = {
      enter: {},
      leave: {},
      state: {},
      flag: {}
    };
    this._stack = [];
  }

  run(type, args) {
    const cbs = this._callbacks[type] ?? {};
    Object.entries(this._state)
      .filter(([state]) => Object.hasOwn(cbs, state))
      .forEach(([state]) => cbs[state]?.forEach(fn => fn.apply(global, args)));
  }

  on(type, state, cb) {
    this._callbacks[type] ??= {};
    this._callbacks[type][state] ??= [];
    this._callbacks[type][state].push(cb);
    return this;
  }

  setState(state, args) {
    this._state = state;
    this.run('enter', args);
    this.run('state', args);
    return this;
  }

  nextState(symbol) {
    return Object.entries(this._state)
      .filter(([state]) => Object.hasOwn(this._states, state))
      .reduce((newState, [state]) => {
        const next = this._states[state];
        if (Object.hasOwn(next, symbol)) {
          Object.assign(newState, next[symbol]);
        }
        if (Object.hasOwn(next, '')) {
          Object.assign(newState, next['']);
        }
        return newState;
      }, {});
  }

  go(symbol, args) {
    return this.setState(this.nextState(symbol), args);
  }

  leave(args) {
    this._stack.pop();
    this.run('leave', args);
    this._state = this._stack[this._stack.length - 1];
    return this;
  }

  enter(symbol, args = []) {
    const next = this.nextState(symbol);
    this._stack.push(next);
    this._state = next;
    this.run('flag');
    this.run('enter', args);
    return this;
  }

  transition(stateFrom, symbol, stateTo) {
    this._states[stateFrom] ??= {};
    this._states[stateFrom][symbol] ??= {};
    this._states[stateFrom][symbol][stateTo] = true;
    return this;
  }
}

module.exports = FiniteAutomata;
