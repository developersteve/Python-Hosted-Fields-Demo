(function () {
  var global = window || global;
  var braintree = global.braintree || {};
  var Utils = braintree.Utils || {};

  Utils.makeQueryString = function (params, namespace) {
    var query = [], k, p;
    for(p in params) {
      if (params.hasOwnProperty(p)) {
        var v = params[p];
        if (namespace) {
          k = namespace + "[" + p + "]";
        } else {
          k = p;
        }
        if (typeof v === "object") {
          query.push(Utils.makeQueryString(v, k));
        } else if (v !== undefined && v !== null) {
          query.push(encode(k) + "=" + encode(v));
        }
      }
    }
    return query.join("&");
  };

  Utils.decodeQueryString = function (queryString) {
    var params = {},
        paramPairs = queryString.split("&");

    for (var i = 0; i < paramPairs.length; i++) {
      var paramPair = paramPairs[i].split("=");
      var key = paramPair[0];
      var value = decodeURIComponent(paramPair[1]);
      params[key] = value;
    }

    return params;
  };

  Utils.getParams = function (url) {
    var urlSegments = url.split("?");

    if (urlSegments.length !== 2) {
      return {};
    }

    return braintree.Utils.decodeQueryString(urlSegments[1]);
  };

  Utils.isFunction = function (func) {
    return Object.prototype.toString.call(func) === "[object Function]";
  };

  Utils.bind = function (func, context) {
    return function () {
      func.apply(context, arguments);
    };
  };

  Utils.addEventListener = function (context, event, handler) {
    if (context.addEventListener) {
      context.addEventListener(event, handler, false);
    } else if (context.attachEvent)  {
      context.attachEvent("on" + event, handler);
    }
  };

  Utils.removeEventListener = function (context, event, handler) {
    if (context.removeEventListener) {
      context.removeEventListener(event, handler, false);
    } else if (context.detachEvent)  {
      context.detachEvent("on" + event, handler);
    }
  };

  function encode(str) {
    switch(str) {
      case null:
      case undefined:
        return "";
      case true:
        return "1";
      case false:
        return "0";
      default:
        return encodeURIComponent(str);
    }
  }

  braintree.Utils = Utils;
  global.braintree = braintree;
})();

(function () {
  var global = window || global;
  var braintree = global.braintree || {};

  function MessageBus(host) {
    this.host = host || window;
    this.handlers = [];

    braintree.Utils.addEventListener(this.host, "message", braintree.Utils.bind(this.receive, this));
  }

  MessageBus.prototype.receive = function (event) {
    var i, message, parsed, type;

    try {
      parsed = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    type = parsed.type;
    message = new MessageBus.Message(this, event.source, parsed.data);

    for (i = 0; i < this.handlers.length; i++) {
      if (this.handlers[i].type === type) {
        this.handlers[i].handler(message);
      }
    }
  };

  MessageBus.prototype.send = function (source, type, data) {
    source.postMessage(
      JSON.stringify({
        type: type,
        data: data
      }),
      "*"
    );
  };

  MessageBus.prototype.register = function (type, handler) {
    this.handlers.push({
      type: type,
      handler: handler
    });
  };

  MessageBus.prototype.unregister = function (type, handler) {
    for (var i = this.handlers.length - 1; i >= 0; i--) {
      if (this.handlers[i].type === type && this.handlers[i].handler === handler) {
        return this.handlers.splice(i, 1);
      }
    }
  };

  MessageBus.Message = function (bus, source, content) {
    this.bus = bus;
    this.source = source;
    this.content = content;
  };

  MessageBus.Message.prototype.reply = function (type, data) {
    this.bus.send(this.source, type, data);
  };

  braintree.MessageBus = MessageBus;
  global.braintree = braintree;
})();

(function () {
  var global = window || global;
  var braintree = global.braintree || {};

  function RPCServer(bus) {
    this.bus = bus;
    this.methods = {};

    this.bus.register("rpc_request", braintree.Utils.bind(this.handleRequest, this));
  }

  RPCServer.prototype.handleRequest = function (message) {
    var reply,
        content = message.content,
        args = content.args || [],
        thisMethod = this.methods[content.method];

    if (typeof thisMethod === "function") {
      reply = function () {
        message.reply("rpc_response", {
          id: content.id,
          response: Array.prototype.slice.call(arguments)
        });
      };

      args.push(reply);

      thisMethod.apply(null, args);
    }
  };

  RPCServer.prototype.define = function (method, handler) {
    this.methods[method] = handler;
  };

  braintree.RPCServer = RPCServer;
  global.braintree = braintree;
})();

(function () {
  var global = window || global;
  var braintree = global.braintree || {};

  function RPCClient(bus, target) {
    this.bus = bus;
    this.target = target || window.parent;
    this.counter = 0;
    this.callbacks = {};

    this.bus.register("rpc_response", braintree.Utils.bind(this.handleResponse, this));
  }

  RPCClient.prototype.handleResponse = function (message) {
    var content = message.content,
        thisCallback = this.callbacks[content.id];

    if (typeof thisCallback === "function") {
      thisCallback.apply(null, content.response);
      delete this.callbacks[content.id];
    }
  };

  RPCClient.prototype.invoke = function (method, args, callback) {
    var counter = this.counter++;

    this.callbacks[counter] = callback;
    this.bus.send(this.target, "rpc_request", { id: counter, method: method, args: args });
  };

  braintree.RPCClient = RPCClient;
  global.braintree = braintree;
})();

(function (global) {
  "use strict";

  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  braintree.api.configure = function (options) {
    return new braintree.api.Client(options);
  };

  global.braintree = braintree;
})(this);

(function (global) {
  "use strict";

  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  var ERRORS = {
    "ClientTokenInvalid": "Braintree API Client Misconfigured: clientToken is invalid.",
    "ClientTokenMissing": "Braintree API Client Misconfigured: clientToken required."
  };

  function deserialize(response, mapper) {
    if (response.status >= 400) {
      return [response, null];
    } else {
      return [null, mapper(response)];
    }
  }

  function parseClientToken(rawClientToken) {
    var clientToken;

    if (typeof rawClientToken === "object" && rawClientToken !== null) {
      clientToken = rawClientToken;
    } else {
      try {
        clientToken = JSON.parse(rawClientToken);
      } catch (e) {
        throw new Error(ERRORS.ClientTokenInvalid);
      }
    }

    return clientToken;
  }

  function Client(options) {
    var parsedClientToken;

    this.attrs = {};

    if (options.hasOwnProperty("sharedCustomerIdentifier")) {
      this.attrs.sharedCustomerIdentifier = options.sharedCustomerIdentifier;
    }

    if (!options.hasOwnProperty("clientToken")) {
      throw new Error(ERRORS.ClientTokenMissing);
    }

    parsedClientToken = parseClientToken(options.clientToken);

    if (!parsedClientToken.hasOwnProperty("authUrl") || !parsedClientToken.hasOwnProperty("clientApiUrl")) {
      throw new Error(ERRORS.ClientTokenInvalid);
    }

    this.driver = options.driver || braintree.api.JSONPDriver;
    this.authUrl = parsedClientToken.authUrl;
    this.clientApiUrl = parsedClientToken.clientApiUrl;
    this.customerId = options.customerId;
    this.challenges = parsedClientToken.challenges;

    this.attrs.authorizationFingerprint = parsedClientToken.authorizationFingerprint;
    this.attrs.sharedCustomerIdentifierType = options.sharedCustomerIdentifierType;

    this.timeoutWatchers = [];
    if(options.hasOwnProperty("timeout")) {
      this.requestTimeout = options.timeout;
    } else {
      this.requestTimeout = 60000;
    }
  }

  function merge_options(obj1, obj2) {
    var obj3 = {};
    var attrname;
    for (attrname in obj1) {
      if (obj1.hasOwnProperty(attrname)) {
        obj3[attrname] = obj1[attrname];
      }
    }
    for (attrname in obj2) {
      if (obj2.hasOwnProperty(attrname)) {
        obj3[attrname] = obj2[attrname];
      }
    }
    return obj3;
  }


  Client.prototype.requestWithTimeout = function(url, attrs, deserializer, method, callback) {
    var client = this;
    var uniqueName = method(
      url,
      attrs,
      function(data, uniqueName) {
        if (client.timeoutWatchers[uniqueName]) {
          clearTimeout(client.timeoutWatchers[uniqueName]);
          var args = deserialize(data, function (d) { return deserializer(d);});
          callback.apply(null, args);
        }
      });

      if (client.requestTimeout > 0) {
        this.timeoutWatchers[uniqueName] = setTimeout(function() {
          client.timeoutWatchers[uniqueName] = null;
          callback.apply(null, [{"errors": "Unknown error"}, null]);
        }, client.requestTimeout);
      } else {
        callback.apply(null, [{"errors": "Unknown error"}, null]);
      }
  };

  Client.prototype.post = function(url, attrs, deserializer, callback) {
    this.requestWithTimeout(url, attrs, deserializer, this.driver.post, callback);
  };

  Client.prototype.get = function (url, attrs, deserializer, callback) {
    this.requestWithTimeout(url, attrs, deserializer, this.driver.get, callback);
  };

  Client.prototype.put = function(url, attrs, deserializer, callback) {
    this.requestWithTimeout(url, attrs, deserializer, this.driver.put, callback);
  };

  Client.prototype.getCreditCards = function (callback) {
    this.get(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "v1/payment_methods"]),
      this.attrs,
      function(d) {
        var i = 0;
        var len = d.paymentMethods.length;
        var creditCards = [];

        for (i; i < len; i++) {
          creditCards.push(new global.braintree.api.CreditCard(d.paymentMethods[i]));
        }

        return creditCards;
      },
      callback
    );
  };

  Client.prototype.tokenizeCard = function (attrs, callback) {
    attrs.options = { validate: false };
    this.addCreditCard(attrs, function(err, result){
      if(result && result.nonce){
        callback(err, result.nonce);
      } else{
        callback("Unable to tokenize card.", null);
      }
    });
  };

  Client.prototype.addSEPAMandate = function(attrs, callback) {
    var merged_attrs = merge_options(this.attrs, {sepaMandate: attrs});
    this.post(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "v1", "sepa_mandates.json"]),
      merged_attrs,
      function (d) { return new global.braintree.api.SEPAMandate(d.sepaMandates[0]); },
      callback
    );
  };

  Client.prototype.acceptSEPAMandate = function(mandateReferenceNumber, callback) {
    this.put(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "v1", "sepa_mandates", mandateReferenceNumber, "accept"]),
      this.attrs,
      function (d) { return new global.braintree.api.SEPABankAccount(d.sepaBankAccounts[0]); },
      callback
    );
  };

  Client.prototype.getSEPAMandate = function(mandateIdentifier, callback) {
    var merged_attrs;
    if(mandateIdentifier.paymentMethodToken) {
      merged_attrs = merge_options(this.attrs, {paymentMethodToken: mandateIdentifier.paymentMethodToken});
    } else {
      merged_attrs = this.attrs;
    }
    this.get(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "v1", "sepa_mandates", mandateIdentifier.mandateReferenceNumber || ""]),
      merged_attrs,
      function (d) { return new global.braintree.api.SEPAMandate(d.sepaMandates[0]); },
      callback
    );
  };


  Client.prototype.addCreditCard = function (attrs, callback) {
    var share = attrs.share;
    delete attrs.share;
    var merged_attrs = merge_options(this.attrs, {share: share, creditCard: attrs});
    this.post(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "v1/payment_methods/credit_cards"]),
      merged_attrs,
      function (d) {
        return new global.braintree.api.CreditCard(d.creditCards[0]);
      },
      callback
    );
  };

  Client.prototype.unlockCreditCard = function (creditCard, params, callback) {
    var attrs = merge_options(this.attrs, {challengeResponses: params});
    this.put(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "v1/payment_methods/", creditCard.nonce]),
      attrs,
      function (d) { return new global.braintree.api.CreditCard(d.paymentMethods[0]); },
      callback
    );
  };

  Client.prototype.sendAnalyticsEvents = function(events, callback) {
    var self = this,
      eventObjects = [];
    events = global.braintree.api.util.isArray(events) ? events : [events];

    for (var event in events) {
      if (events.hasOwnProperty(event)) {
        eventObjects.push({ kind: events[event] });
      }
    }

    var attrs = merge_options(this.attrs, { analytics: eventObjects });
    var uniqueName = this.driver.post(
      braintree.api.util.joinUrlFragments([this.clientApiUrl, "analytics"]),
      attrs,
      function (data, uniqueName) {
        if (self.timeoutWatchers[uniqueName]) {
          clearTimeout(self.timeoutWatchers[uniqueName]);
          var args = deserialize(data, function (d) { return d; });
          if (callback) {
            callback.apply(null, args);
          }
        }
      });
    this.timeoutWatchers[uniqueName] = setTimeout(function() {
      self.timeoutWatchers[uniqueName] = null;
      callback.apply(null, [{"errors": "Unknown error"}, null]);
    }, this.requestTimeout);
  };

  braintree.api.Client = Client;
  global.braintree = braintree;
})(this);

(function (global) {
  "use strict";

  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  var ATTRIBUTES = [
    "billingAddress",
    "branding",
    "createdAt",
    "createdAtMerchant",
    "createdAtMerchantName",
    "details",
    "isLocked",
    "lastUsedAt",
    "lastUsedAtMerchant",
    "lastUsedAtMerchantName",
    "lastUsedByCurrentMerchant",
    "nonce",
    "securityQuestions",
    "type"
  ];

  function CreditCard(attributes) {
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      var attribute = ATTRIBUTES[i];
      this[attribute] = attributes[attribute];
    }
  }

  braintree.api.CreditCard = CreditCard;
  global.braintree = braintree;
})(this);


(function (global) {
  "use strict";
  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  braintree.api.JSONPDriver = {};

  braintree.api.JSONPDriver.get = function (path, params, callback) {
    return braintree.api.JSONP.get(path, params, callback);
  };

  braintree.api.JSONPDriver.post = function(path, params, callback) {
    params._method = "POST";
    return braintree.api.JSONP.get(path, params, callback);
  };

  braintree.api.JSONPDriver.put = function(path, params, callback) {
    params._method = "PUT";
    return braintree.api.JSONP.get(path, params, callback);
  };

  global.braintree = braintree;
})(this);


/*
* Lightweight JSONP fetcher
* Copyright 2010-2012 Erik Karlsson. All rights reserved.
* BSD licensed
*/
(function (global) {
  var braintree = global['braintree'] || {};
  braintree.api = braintree['api'] || {};

  var head,
      counter = 0,
      window = this,
      config = {};

  function load(url, pfnError) {
    var script = document.createElement('script'),
        done = false;
    script.src = url;
    script.async = true;

    var errorHandler = pfnError || config.error;
    if ( typeof errorHandler === 'function' ) {
      script.onerror = function(ex){
        errorHandler({url: url, event: ex});
      };
    }

    script.onload = script.onreadystatechange = function() {
      if ( !done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") ) {
        done = true;
        script.onload = script.onreadystatechange = null;
        if ( script && script.parentNode ) {
          script.parentNode.removeChild( script );
        }
      }
    };

    if ( !head ) {
      head = document.getElementsByTagName('head')[0];
    }
    head.appendChild( script );
  }

  function encode(str) {
    return encodeURIComponent(str);
  }

  function stringify(params, namespace) {
    var query = [], k, p;
    for(var p in params) {
      v = params[p];
      if (namespace) {
        if (braintree.api.util.isArray(params)) {
          k = namespace + "[]";
        } else {
          k = namespace + "[" + p + "]";
        }
      } else {
        k = p;
      }
      if (typeof v == "object") {
        query.push(stringify(v, k));
      } else {
        query.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      }
    }
    return query.join("&");
  }

  function jsonp(url, params, callback, callbackName) {
    var query = (url||'').indexOf('?') === -1 ? '?' : '&', key;

    callbackName = (callbackName||config['callbackName']||'callback');
    var uniqueName = callbackName + "_json" + (++counter);

    query += stringify(populateParams(params));

    window[ uniqueName ] = function(data){
      callback(data, uniqueName);
      try {
        delete window[ uniqueName ];
      } catch (e) {}
      window[ uniqueName ] = null;
    };

    load(url + query + '&' + callbackName + '=' + uniqueName);
    return uniqueName;
  }

  function setDefaults(obj){
    config = obj;
  }

  function populateParams(params){
    params.braintreeLibraryVersion = "js/" + braintree.api.version;
    return params;
  }

  braintree.api.JSONP = {
    get: jsonp,
    init: setDefaults,
    stringify: stringify,
    populateParams: populateParams
  };

  global.braintree = braintree;
}(this));

(function (global) {
  "use strict";

  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  var ATTRIBUTES = [
    "bic",
    "maskedIBAN",
    "nonce",
    "accountHolderName"
  ];

  function SEPABankAccount(attributes) {
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      var attribute = ATTRIBUTES[i];
      this[attribute] = attributes[attribute];
    }
  }

  braintree.api.SEPABankAccount = SEPABankAccount;
  global.braintree = braintree;
})(this);


(function (global) {
  "use strict";

  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  var ATTRIBUTES = [
    "accountHolderName",
    "bic",
    "longFormURL",
    "mandateReferenceNumber",
    "maskedIBAN",
    "shortForm"
  ];

  function SEPAMandate(attributes) {
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      var attribute = ATTRIBUTES[i];
      this[attribute] = attributes[attribute];
    }
  }

  braintree.api.SEPAMandate = SEPAMandate;
  global.braintree = braintree;
})(this);


(function (global) {
  "use strict";
  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  braintree.api.testing = {};

  braintree.api.testing.createClient = function (options, callback) {
    var driver = options.driver || braintree.api.JSONPDriver;
    var sharedCustomerIdentifier = options.sharedCustomerIdentifier || Math.random() + "";
    var baseUrl = braintree.api.util.joinUrlFragments([global.GATEWAY_HOST + ":" + global.GATEWAY_PORT, "merchants", options.merchantId]);
    var attrs = {
      "merchantId": options.merchantId,
      "publicKey": options.publicKey,
      "customer": options.customer,
      "sharedCustomerIdentifierType": "testing",
      "sharedCustomerIdentifier": sharedCustomerIdentifier,
      "baseUrl": baseUrl
    };
    if (options.creditCard) {
      attrs.creditCard = options.creditCard;
    }
    if (options.SEPAMandateType) {
      attrs.sepaMandateType = options.SEPAMandateType;
    }
    driver.post(
      braintree.api.util.joinUrlFragments([baseUrl, "client_api/testing/setup"]),
      attrs,
      function (response) {
        options.clientToken = JSON.stringify({
          authUrl: "fake_auth_url",
          clientApiUrl: braintree.api.util.joinUrlFragments([baseUrl, "client_api"]),
          authorizationFingerprint: response.authorizationFingerprint
        });
        options.sharedCustomerIdentifier = sharedCustomerIdentifier;
        options.sharedCustomerIdentifierType = "testing";
        options.customerId = response.token;
        var client = new braintree.api.Client(options);
        callback(client);
      }
    );
  };
  global.braintree = braintree;
})(this);

(function (global) {
  "use strict";
  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  function Util(){
  }

  Util.prototype.joinUrlFragments = function (fragments) {
    var strippedFragments = [],
        strippedFragment,
        i;

    for (i = 0; i < fragments.length; i++) {
      strippedFragment = fragments[i];
      if (strippedFragment.charAt(strippedFragment.length - 1) === "/") {
        strippedFragment = strippedFragment.substring(0, strippedFragment.length - 1);
      }
      if (strippedFragment.charAt(0) === "/") {
        strippedFragment = strippedFragment.substring(1);
      }

      strippedFragments.push(strippedFragment);
    }

    return strippedFragments.join("/");
  };

  Util.prototype.isArray = function (value) {
    return value && typeof value === "object" && typeof value.length === "number" &&
        global.toString.call(value) === "[object Array]" || false;
  };

  braintree.api.util = new Util();

})(this);

(function (global) {
  "use strict";

  var version = "0.2.1";

  var braintree = global.braintree || {};
  braintree.api = braintree.api || {};

  braintree.api.version = version;
})(this);

(function(global){
  braintree = global.braintree || {};

  braintree.Form = function(client, htmlForm, nonceInput){
    this.client = client;
    this.htmlForm = htmlForm;
    this.paymentMethodNonce = nonceInput;
  }

  braintree.Form.setup = function (client, options) {
    var htmlForm = document.getElementById(options.id);
    var nonceInput = this.getNonceInput(options.paymentMethodNonceInputField);
    htmlForm.appendChild(nonceInput);

    var form = new braintree.Form(client, htmlForm, nonceInput);
    form.hijackForm();

    return form;
  };

  braintree.Form.getNonceInput = function (paymentMethodNonceInputField) {
    if (typeof paymentMethodNonceInputField === 'object') {
      return paymentMethodNonceInputField;
    }

    var nonceInputName = 'payment_method_nonce';
    if (typeof paymentMethodNonceInputField === 'string') {
      nonceInputName = paymentMethodNonceInputField;
    }

    var nonceInput = document.createElement('input');
    nonceInput.name = nonceInputName;
    nonceInput.type = 'hidden';

    return nonceInput;
  };

  braintree.Form.prototype.registerAsyncTaskOnSubmit = function (form, asyncTask) {
    var onsubmitHandler = function (event){
      asyncTask(function callNativeFormSubmit() { form.submit(); });
      event.preventDefault ? event.preventDefault() : event.returnValue = false;
    };

    if (window.jQuery) {
      window.jQuery(form).submit(onsubmitHandler);
    } else if (form.addEventListener) {
      form.addEventListener('submit', onsubmitHandler, false);
    } else if (form.attachEvent) {
      form.attachEvent('onsubmit', onsubmitHandler);
    }
  };

  braintree.Form.prototype.hijackForm = function () {
    var self = this;
    this.registerAsyncTaskOnSubmit(this.htmlForm, function (submitForm) {
      if (self.paymentMethodNonce.value && self.paymentMethodNonce.value != '') {
        submitForm();
        return;
      }

      self.client.tokenizeCard(self.extractValues(self.htmlForm, {}), function(err, paymentMethodNonce) {
        if (err) {
          throw "Unable to process payments at this time.";
        }

        self.paymentMethodNonce.value = paymentMethodNonce;
        submitForm();
      });
    });
  };

  braintree.Form.prototype.extractValues = function (node, results) {
    var children = node.children,
        child, i;

    for (i = 0; i < children.length; i++) {
      child = children[i];

      if (child.nodeType === 1 && child.attributes['data-braintree-name']) {
        results[child.getAttribute('data-braintree-name')] = child.value;
        this.scrubAttributes(child);
      } else if (child.children && child.children.length > 0) {
        this.extractValues(child, results);
      }
    }

    return results;
  };

  braintree.Form.prototype.scrubAttributes = function(node){
    try { node.attributes.removeNamedItem('name'); }
    catch (e) {}
  };

  global.braintree = braintree;
})(this);

(function () {
  'use strict';


(function () {
  var braintree = window.braintree || {};
  braintree.paypal = braintree.paypal || {};

  braintree.paypal.VERSION = {
    major: 'beta',
    minor: '',
    build: ''
  };

  window.braintree = braintree;
})();

(function () {
  braintree.paypal.browser = {};

  braintree.paypal.browser.DEFAULT_POPUP_TARGET = 'braintree_paypal_popup';
  braintree.paypal.browser.DEFAULT_POPUP_HEIGHT = 600;
  braintree.paypal.browser.DEFAULT_POPUP_WIDTH  = 800;

  braintree.paypal.browser.isMobile = function () {
    var isMobileUserAgent = /Android|webOS|iPhone|iPod|Blackberry/i
        .test(window.navigator.userAgent);
    return isMobileUserAgent && window.outerWidth <= 640;
  };

  braintree.paypal.browser.detectedPostMessage = function () {
    return !!window.postMessage;
  };

  braintree.paypal.browser.popup = function (link, options) {
    if (!options) options = {};
    options.target = options.target || link.target ||
        braintree.paypal.browser.DEFAULT_POPUP_TARGET;
    options.height = options.height ||
        braintree.paypal.browser.DEFAULT_POPUP_HEIGHT;
    options.width = options.width ||
        braintree.paypal.browser.DEFAULT_POPUP_WIDTH;

    var href = typeof link.href !== 'undefined' ? link.href : String(link);
    var target = options.target || link.target;

    var sb = [];
    for (var option in options) {
      if (options.hasOwnProperty(option)) {
        switch (option) {
          case 'width':
          case 'height':
          case 'top':
          case 'left':
            sb.push(option + '=' + options[option]);
            break;
          case 'target':
          case 'noreferrer':
            break;
          default:
            sb.push(option + '=' + (options[option] ? 1 : 0));
        }
      }
    }
    var optionString = sb.join(',');
    var newWin = window.open(href, target, optionString);
    if (!newWin) {
      return true;
    }
    newWin.focus();
    return false;
  };
})();

(function () {
  braintree.paypal.util = {};

  braintree.paypal.util.trim = typeof String.prototype.trim === 'function' ?
    function (str) { return str.trim(); } :
    function (str) { return str.replace(/^\s+|\s+$/, ''); };

  braintree.paypal.util.btoa = typeof window.btoa === 'function' ?
    function (str) { return window.btoa(str); } :
    function (str) {
      var keyStr =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      var output = '';
      var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
      var i = 0;

      while (i < str.length) {
        chr1 = str.charCodeAt(i++);
        chr2 = str.charCodeAt(i++);
        chr3 = str.charCodeAt(i++);

        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;

        if (isNaN(chr2)) {
          enc3 = enc4 = 64;
        } else if (isNaN(chr3)) {
          enc4 = 64;
        }

        output = output + keyStr.charAt(enc1) + keyStr.charAt(enc2) +
            keyStr.charAt(enc3) + keyStr.charAt(enc4);
      }

      return output;
    };

  braintree.paypal.util.normalizeElement = function (element) {
    if (element && element.nodeType && element.nodeType === 1) {
      return element;
    }
    if (element && window.jQuery && element instanceof jQuery && element.length !== 0) {
      return element[0];
    }
    if (typeof element === 'string' && document.getElementById(element)) {
      return document.getElementById(element);
    }
    throw new Error('[' + element + '] is not a valid DOM Element');
  };

  braintree.paypal.util.generateUid = function () {
    var uid = '';
    for (var i = 0; i < 32; i++) {
      var r = Math.floor(Math.random() * 16);
      uid += r.toString(16);
    }
    return uid;
  };

  braintree.paypal.util.castToBoolean = function (value) {
    return /^(true|1)$/i.test(value);
  };
})();

(function () {
  braintree.paypal.create = function (clientToken, options) {
    if (!braintree.paypal.browser.detectedPostMessage()) {
      if (typeof options.onUnsupported === 'function') {
        options.onUnsupported(new Error('unsupported browser detected'));
      }
      return;
    }
    var client = new braintree.paypal.Client(clientToken, options);
    client.init();
    return client;
  };
})();

(function () {
  function LoggedInView (options) {
    this.options = options;
    this.container = this.createViewContainer();
    this.createPayPalName();
    this.emailNode = this.createEmailNode();
    this.logoutNode = this.createLogoutNode();
  }

  LoggedInView.prototype.createViewContainer = function () {
    var container = document.createElement('div');
    container.id = 'braintree-paypal-loggedin';
    var cssStyles = [
      'display: none',
      'max-width: 500px',
      'overflow: hidden',
      'background-image: url(' + this.options.assetsUrl + '/pwpp/beta/images/paypal-small.svg)',
      'background-position: left center',
      'background-repeat: no-repeat',
      'background-size: 26px auto'
    ].join(';');
    container.style.cssText = cssStyles;
    this.options.container.appendChild(container);

    return container;
  };

  LoggedInView.prototype.createPayPalName = function () {
    var element = document.createElement('span');
    element.id = 'bt-pp-name';
    element.innerHTML = 'PayPal';
    var cssStyles = [
      'color: #283036',
      'font-size: 16px',
      'font-weight: 800',
      'font-family: "Helvetica Neue", Helvetica, Arial, sans-serif',
      'line-height: 50px',
      'margin-left: 35px',
      'float: left'
    ].join(';');
    element.style.cssText = cssStyles;
    return this.container.appendChild(element);
  };

  LoggedInView.prototype.createEmailNode = function () {
    var element = document.createElement('span');
    element.id = 'bt-pp-email';
    var cssStyles = [
      'color: #6e787f',
      'font-size: 16px',
      'font-family: "Helvetica Neue", Helvetica, Arial, sans-serif',
      'line-height: 50px',
      'margin-left: 5px',
      'float: left'
    ].join(';');
    element.style.cssText = cssStyles;
    return this.container.appendChild(element);
  };

  LoggedInView.prototype.createLogoutNode = function () {
    var element = document.createElement('button');
    element.id = 'bt-pp-cancel';
    element.innerHTML = 'Click to cancel';
    var cssStyles = [
      'color: #3d95ce',
      'font-size: 12px',
      'font-family: "Helvetica Neue", Helvetica, Arial, sans-serif',
      'line-height: 50px',
      'margin: 0',
      'padding: 0',
      'float: right',
      'background-color: transparent',
      'border: 0',
      'cursor: pointer',
      'text-decoration: underline'
    ].join(';');
    element.style.cssText = cssStyles;
    return this.container.appendChild(element);
  };

  LoggedInView.prototype.show = function () {
    this.container.style.display = 'block';
  };

  LoggedInView.prototype.hide = function () {
    this.container.style.display = 'none';
  };

  braintree.paypal.LoggedInView = LoggedInView;
})();

(function () {
  function LoggedOutView (options) {
    this.options = options;

    this.assetsUrl = this.options.assetsUrl;
    this.container = this.createViewContainer();
    this.buttonNode = this.createPayWithPayPalButton();
  }

  LoggedOutView.prototype.createViewContainer = function () {
    var container = document.createElement('div');
    container.id = 'braintree-paypal-loggedout';

    this.options.container.appendChild(container);

    return container;
  };

  LoggedOutView.prototype.createPayWithPayPalButton = function () {
    var element = document.createElement('a');
    element.id = 'braintree-paypal-button';
    element.href = '#';
    var cssStyles = [
      'display: block',
      'width: 115px',
      'height: 44px',
      'overflow: hidden'
    ].join(';');
    element.style.cssText = cssStyles;

    var image = new Image();
    image.src = this.assetsUrl + '/pwpp/beta/images/pay-with-paypal.png';
    var imageCssText = [
      'max-width: 100%',
      'display: block',
      'width: 100%',
      'height: 100%',
      'outline: none',
      'border: 0'
    ].join(';');
    image.style.cssText = imageCssText;

    element.appendChild(image);
    return this.container.appendChild(element);
  };

  LoggedOutView.prototype.show = function () {
    this.container.style.display = 'block';
  };

  LoggedOutView.prototype.hide = function () {
    this.container.style.display = 'none';
  };

  braintree.paypal.LoggedOutView = LoggedOutView;
})();

(function () {
  function Client (clientToken, options) {
    options = options || {};
    this.clientToken = this.parseClientToken(clientToken);
    if (this.clientToken && options.displayName) {
      this.clientToken.paypalDisplayName = options.displayName;
    }

    this.locale = options.locale || 'en';
    this.singleUse = options.singleUse || false;
    this.demo = options.demo || false;

    this.container = options.container;
    this.paymentMethodNonceInputField = options.paymentMethodNonceInputField;
    this.frame = null;

    this.insertFrameFunction = options.insertFrame;
    this.onSuccess = options.onSuccess;
    this.onUnsupported = options.onUnsupported;
    this.rpcServer = null;
    this.loggedInView = null;
    this.loggedOutView = null;

    this.insertUI = true;
  }

  Client.prototype.isMobile = braintree.paypal.browser.isMobile();

  Client.prototype.init = function () {
    if (!this.isPayPalEnabled()) {
      if (typeof this.onUnsupported === 'function') {
        this.onUnsupported(new Error('PayPal is not enabled'));
      }
      return;
    }
    if (!this.hasSecureBrowserProtocol()) {
      if (typeof this.onUnsupported === 'function') {
        this.onUnsupported(new Error('unsupported protocol detected'));
      }
      return;
    }
    this.setupDomElements();
    this.setupPaymentMethodNonceInputField();
    this.setupViews();
    this.setupRPCServer();
  };

  Client.prototype.isPayPalEnabled = function () {
    return !!this.clientToken;
  };

  Client.prototype.hasSecureBrowserProtocol = function () {
    return /https/.test(window.location.protocol) || this.clientToken.paypalAllowHttp;
  };

  Client.prototype.canBeInitialized = function () {
    return this.isPayPalEnabled() && this.hasSecureBrowserProtocol();
  };

  Client.prototype.setupDomElements = function () {
    if (this.insertUI) {
      this.container = braintree.paypal.util.normalizeElement(this.container);
    }
  };

  Client.prototype.setupPaymentMethodNonceInputField = function () {
    if (!this.insertUI) return;
    var inputField = this.paymentMethodNonceInputField;
    if (!braintree.Utils.isFunction(inputField)) {
      if (inputField !== undefined) {
        inputField = braintree.paypal.util.normalizeElement(inputField);
      } else {
        inputField = this.createPaymentMethodNonceInputField();
      }
      this.paymentMethodNonceInputField = inputField;
    }
  };

  Client.prototype.setupViews = function () {
    if (this.insertUI) {
      this.loggedInView = new braintree.paypal.LoggedInView({
        container: this.container,
        assetsUrl: this.clientToken.assetsUrl
      });
      this.loggedOutView = new braintree.paypal.LoggedOutView({
        assetsUrl: this.clientToken.assetsUrl,
        container: this.container
      });

      braintree.Utils.addEventListener(this.loggedOutView.buttonNode, 'click', braintree.Utils.bind(this.handleButtonClick, this));
      braintree.Utils.addEventListener(this.loggedInView.logoutNode, 'click', braintree.Utils.bind(this.showLoggedOutContent, this));
    }
  };

  Client.prototype.setupRPCServer = function () {
    var bus = new braintree.MessageBus(window);
    this.rpcServer = new braintree.RPCServer(bus, window);

    this.rpcServer.define('closePayPalModal', braintree.Utils.bind(this.handleCloseMessage, this));
    this.rpcServer.define('receivePayPalData', braintree.Utils.bind(this.handleSuccessfulAuthentication, this));
  };

  Client.prototype.attachMobileEvents = function () {
   if (this.isMobile) {
      var self = this;
      var updateFrameHeight = function () {
        self.frame.style.height = document.body.scrollHeight + 'px';
      };
      window.addEventListener('resize', function (event) {
        updateFrameHeight();
      });
      updateFrameHeight();
      window.scrollTo(0, 0);
    }
  };

  Client.prototype.createFrameUrl = function () {
    var src = '';
    src += this.clientToken.assetsUrl + '/pwpp/beta/html/braintree-frame.html';
    src += '?locale=' + this.locale;
    src += '&demo=' + this.demo;
    src += '&singleUse=' + this.singleUse;
    src += '&displayName=' + encodeURIComponent(this.clientToken.paypalDisplayName);
    src += '&clientApiUrl=' + this.clientToken.clientApiUrl;
    src += '&authUrl=' + this.clientToken.authUrl;
    src += '&authorizationFingerprint=' + this.clientToken.authorizationFingerprint;
    src += '&paypalBaseUrl=' + this.clientToken.paypalBaseUrl;
    src += '&paypalClientId=' + this.clientToken.paypalClientId;
    src += '&paypalPrivacyUrl=' + this.clientToken.paypalPrivacyUrl;
    src += '&paypalUserAgreementUrl=' + this.clientToken.paypalUserAgreementUrl;
    src += '&offline=' +  this.clientToken.paypalEnvironmentNoNetwork;

    return src;
  };

  Client.prototype.createPaymentMethodNonceInputField = function () {
    var input = document.createElement('input');
    input.name = 'payment_method_nonce';
    input.type = 'hidden';
    return this.container.appendChild(input);
  };

  Client.prototype.createFrame = function () {
    var src = this.createFrameUrl();

    var iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.id = 'braintree-paypal-frame';
    iframe.allowTransparency = true;
    iframe.height = '100%';
    iframe.width = '100%';
    iframe.style.position = this.isMobile ? 'absolute' : 'fixed';
    iframe.style.top = 0;
    iframe.style.left = 0;
    iframe.style.bottom = 0;
    iframe.style.zIndex = 20001;
    iframe.style.padding = 0;
    iframe.style.margin = 0;
    iframe.style.border = 0;
    return iframe;
  };

  Client.prototype.removeFrame = function (parent) {
    parent = parent || document.body;
    if (this.frame && parent.contains(this.frame)) {
      parent.removeChild(this.frame);
    }
  };

  Client.prototype.insertFrame = function () {
    if (this.insertFrameFunction) {
      this.insertFrameFunction(this.createFrameUrl());
    } else {
      this.frame = this.createFrame();
      document.body.appendChild(this.frame);
    }
    this.attachMobileEvents();
  };

  Client.prototype.handleButtonClick = function (event) {
    if (event.preventDefault) {
      event.preventDefault();
    } else {
      event.returnValue = false;
    }
    this.openModal();
  };

  Client.prototype.openModal = function () {
    this.removeFrame();
    this.insertFrame();
  };

  Client.prototype.handleSuccessfulAuthentication = function (nonce, email) {
    this.removeFrame();
    if (braintree.Utils.isFunction(this.onSuccess)) {
      this.onSuccess();
    }
    if (braintree.Utils.isFunction(this.paymentMethodNonceInputField)) {
      this.paymentMethodNonceInputField(nonce);
    } else {
      this.showLoggedInContent(email);
      this.setNonceInputValue(nonce);
    }
  };

  Client.prototype.handleCloseMessage = function () {
    this.removeFrame();
  };

  Client.prototype.showLoggedInContent = function (email) {
    this.loggedOutView.hide();

    this.loggedInView.emailNode.innerHTML = email;
    this.loggedInView.show();
  };

  Client.prototype.showLoggedOutContent = function (event) {
    event.preventDefault();

    this.loggedInView.hide();
    this.loggedOutView.show();
    this.setNonceInputValue('');
  };

  Client.prototype.setNonceInputValue = function (value) {
    this.paymentMethodNonceInputField.value = value;
  };

  Client.prototype.parseClientToken = function(token) {
    if (!token || token.length === 0) {
      throw new Error('clientToken not provided.');
    }
    if (!token.paypalEnabled || token.paypalEnabled === 'false') {
      return null;
    }
    return {
      assetsUrl: token.assetsUrl,
      authUrl: token.authUrl,
      authorizationFingerprint: encodeURIComponent(token.authorizationFingerprint),
      clientApiUrl: encodeURIComponent(token.clientApiUrl),
      paypalAllowHttp: braintree.paypal.util.castToBoolean(token.paypal.allowHttp),
      paypalBaseUrl: token.paypal.baseUrl,
      paypalClientId: token.paypal.clientId,
      paypalDisplayName: token.paypal.displayName,
      paypalEnvironmentNoNetwork: braintree.paypal.util.castToBoolean(token.paypal.environmentNoNetwork),
      paypalPrivacyUrl: encodeURIComponent(token.paypal.privacyUrl),
      paypalUserAgreementUrl: encodeURIComponent(token.paypal.userAgreementUrl)
    };
  };

  braintree.paypal.Client = Client;
})();


})();

(function (global) {
  "use strict";


(function () {
  var global = global || window;
  var braintree = global.braintree || {};
  braintree.dropin = braintree.dropin || {};

  braintree.dropin.Shared = {};
  braintree.dropin.CardFrame = {};

  global.braintree = braintree;
})();

(function () {
  braintree.dropin.create = function (clientToken, options) {
    options.clientToken = clientToken;
    var client = new braintree.dropin.Client(options);

    client.initialize();

    return client;
  };
})();

(function () {
  function MerchantFormManager(options) {
    this.form = options.form;
    this.frames = options.frames;
  };

  MerchantFormManager.prototype.initialize = function () {
    this.setElements();
    this.setEvents();

    return this;
  };

  MerchantFormManager.prototype.setElements = function () {
    if (!this.form.payment_method_nonce) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'payment_method_nonce';
      this.form.appendChild(input);
    }

    this.nonceField = this.form.payment_method_nonce;
  };

  MerchantFormManager.prototype.setEvents = function () {
    var self = this;

    braintree.Utils.addEventListener(this.form, 'submit', function () {
      self.handleFormSubmit.apply(self, arguments);
    });
  };

  MerchantFormManager.prototype.handleFormSubmit = function (event) {
    console.log('--- CURRENT NONCE:', this.nonceField.value, '---');

    if (!this.hasNonce()) {
      event.preventDefault ? event.preventDefault() : event.returnValue = false;

      this.frames.card.rpcClient.invoke('requestNonce', [], braintree.Utils.bind(this.handleNonceReply, this));
    }
  };

  MerchantFormManager.prototype.hasNonce = function () {
    return this.nonceField.value.length > 0;
  };

  MerchantFormManager.prototype.handleNonceReply = function (nonce) {
    this.writeNonce(nonce);
    this.form.submit();
  };

  MerchantFormManager.prototype.writeNonce = function (nonce) {
    this.nonceField.value = nonce;
  };

  braintree.dropin.MerchantFormManager = MerchantFormManager;
})();



(function () {
  var getMerchantPageDefaultStyles = function () {
    var body = document.body;
    var styles = window.getComputedStyle ? getComputedStyle(body) : body.currentStyle;

    return {
      overflow: styles.overflow || 'auto'
    }
  };

  function Client(settings) {
    var cardFramePath, modalFramePath, formElement;

    this.clientToken = this.saferJSONParse(settings.clientToken);
    this.paypalOptions = settings.paypal;
    this.container = null;
    this.merchantFormManager = null;
    this.root = settings.root;
    this.configurationRequests = [];
    this.braintreeApiClient = braintree.api.configure({ clientToken: this.clientToken });
    this.paymentMethodNonceReceivedCallback = settings.paymentMethodNonceReceived;

    this.bus = new braintree.MessageBus(this.root);
    this.rpcServer = new braintree.RPCServer(this.bus);
    this.apiProxyServer = new braintree.dropin.APIProxyServer(this.braintreeApiClient);

    this.apiProxyServer.attach(this.rpcServer);

    this.merchantPageDefaultStyles = getMerchantPageDefaultStyles();

    cardFramePath = settings.cardFramePath || this.clientToken.assetsUrl + "/dropin/beta/cards_frame.html";
    modalFramePath = settings.modalFramePath || this.clientToken.assetsUrl + "/dropin/beta/modal_frame.html";

    this.frames = {
      card: this.createFrame(cardFramePath),
      modal: this.createFrame(modalFramePath)
    };

    this.container = this.normalizeElement(settings.container, 'Unable to find valid container.');

    formElement = this.normalizeElement(settings.form) || this.findClosest(this.container, 'form');

    this.merchantFormManager = new braintree.dropin.MerchantFormManager({
      form: formElement,
      frames: this.frames
    }).initialize();

    if (this.clientToken.paypalEnabled) {
      this.configurePayPal();
    }
  }

  Client.prototype.normalizeElement = function (element, errorMsg) {
    if (element && element.nodeType && element.nodeType === 1) {
      return element;
    } else if (element && window.jQuery && element instanceof jQuery && element.length !== 0) {
      return element[0];
    } else if (typeof element === 'string' && document.getElementById(element)) {
      return document.getElementById(element);
    } else {
      if (errorMsg) {
        throw new Error(errorMsg);
      } else {
        return null;
      }
    }
  };

  Client.prototype.initialize = function () {
    var self = this;

    this.initializeModal();

    this.container.appendChild(this.frames.card.element);
    document.body.appendChild(this.frames.modal.element);

    this.rpcServer.define("receiveSharedCustomerIdentifier", function (sharedCustomerIdentifier) {
      self.braintreeApiClient.attrs.sharedCustomerIdentifier = sharedCustomerIdentifier;
      self.braintreeApiClient.attrs.sharedCustomerIdentifierType = "browser_session_cookie_store";

      for (var i = 0; i < self.configurationRequests.length; i++) {
        self.configurationRequests[i](self.clientToken);
      }

      self.configurationRequests = [];
    });

    this.rpcServer.define("getConfiguration", function (reply) {
      reply(self.clientToken);
    });

    this.rpcServer.define("selectPaymentMethod", function (paymentMethods) {
      self.frames.modal.rpcClient.invoke("selectPaymentMethod", [paymentMethods]);
      self.showModal();
    });

    this.rpcServer.define("sendAddedPaymentMethod", function (paymentMethod) {
      self.merchantFormManager.writeNonce(paymentMethod.nonce);
      self.frames.card.rpcClient.invoke("receiveNewPaymentMethod", [paymentMethod]);
    });

    this.rpcServer.define("sendUsedPaymentMethod", function (paymentMethod) {
      self.frames.card.rpcClient.invoke("selectPaymentMethod", [paymentMethod]);
    });

    this.rpcServer.define("sendUnlockedNonce", function (nonce) {
      self.merchantFormManager.writeNonce(nonce);
    });

    this.rpcServer.define("clearNonce", function () {
      self.merchantFormManager.writeNonce('');
    });

    this.rpcServer.define("closeDropInModal", function () {
      self.hideModal();
    });

    this.rpcServer.define('setInlineFrameHeight', function (height) {
      self.frames.card.element.style.height = height + "px";
    });

    this.bus.register("ready", function (message) {
      if (message.source === self.frames.card.element.contentWindow) {
        self.frames.card.rpcClient = new braintree.RPCClient(self.bus, message.source);
      } else if (message.source === self.frames.modal.element.contentWindow) {
        self.frames.modal.rpcClient = new braintree.RPCClient(self.bus, message.source);
      }
    });
  };

  Client.prototype.createFrame = function (endpoint) {
    return new braintree.dropin.FrameContainer(endpoint);
  };

  Client.prototype.initializeModal = function () {
    this.frames.modal.element.style.display = "none";
    this.frames.modal.element.style.position = 'fixed';
    this.frames.modal.element.style.top = "0";
    this.frames.modal.element.style.left = "0";
    this.frames.modal.element.style.height = "100%";
    this.frames.modal.element.style.width = "100%";
  };

  Client.prototype.lockMerchantWindowSize = function () {
    document.body.style.overflow = 'hidden';
  };

  Client.prototype.unlockMerchantWindowSize = function () {
    document.body.style.overflow = this.merchantPageDefaultStyles.overflow;
  };

  Client.prototype.showModal = function () {
    var el = this.frames.modal.element;

    el.style.display = "block";

    this.frames.modal.rpcClient.invoke("open", [], function () {
      setTimeout(function () {
        el.contentWindow.focus();
      }, 200);
    });

    this.lockMerchantWindowSize();
  };

  Client.prototype.hideModal = function () {
    this.frames.modal.element.style.display = "none";
    this.unlockMerchantWindowSize();
  };

  Client.prototype.configurePayPal = function () {
    this.ppClient = new braintree.dropin.PayPalModalService({
      clientToken: this.clientToken,
      paypal: this.paypalOptions
    });

    this.rpcServer.define("paypalModal", braintree.Utils.bind(this.ppClient.openModal, this.ppClient));

    this.ppClient.rpcServer.define('receivePayPalData', braintree.Utils.bind(this.handlePayPalData, this));
  };

  Client.prototype.handlePayPalData = function (nonce, email) {
    this.merchantFormManager.writeNonce(nonce);
    this.frames.card.rpcClient.invoke("receiveNewPaymentMethod", [{ nonce: nonce, email: email }]);
    this.ppClient.removeFrame();
    this.hideModal();
  };

  Client.prototype.saferJSONParse = function (val, err) {
    var result;

    if (typeof val === 'string') {
      try {
        result = JSON.parse(val);
      } catch (e) {
        throw new Error(err);
      }
    } else {
      result = val;
    }

    return result;
  };

  Client.prototype.findClosest = function (node, tagName) {
    tagName = tagName.toUpperCase();

    do {
      if (node.nodeName === tagName) {
        return node;
      }
    } while (node = node.parentNode);

    throw 'Unable to find a valid ' + tagName;
  };

  braintree.dropin.Client = Client;
})();

(function () {
  var RPC_METHOD_NAMES = ["addCreditCard", "getCreditCards", "unlockCreditCard", "sendAnalyticsEvents"];

  function APIProxyServer(apiClient) {
    this.apiClient = apiClient;
  }

  APIProxyServer.prototype.attach = function (rpcServer) {
    var self = this;
    var i = 0;
    var len = RPC_METHOD_NAMES.length;

    function attachDefine(name) {
      rpcServer.define(name, function () {
        self.apiClient[name].apply(self.apiClient, arguments);
      });
    }

    for (i; i < len; i++) {
      attachDefine(RPC_METHOD_NAMES[i]);
    }
  };

  braintree.dropin.APIProxyServer = APIProxyServer;
})();

(function () {
  function FrameContainer(endpoint) {
    this.element = document.createElement("iframe");
    this.element.setAttribute("seamless", "seamless");
    this.element.setAttribute("allowtransparency", "true");
    this.element.setAttribute("width", "100%");
    this.element.setAttribute("height", "68");
    this.element.setAttribute("style", "-webkit-transition: height 160ms linear; -moz-transition: height 160ms linear; -ms-transition: bheight 160ms linear; -o-transition: height 160ms linear; transition: height 160ms linear;");
    this.element.src = endpoint;

    this.element.setAttribute("frameborder", "0");
    this.element.setAttribute("allowtransparency", "true");
    this.element.style.border = "0";
    this.element.style.zIndex = '9999';
  }

  braintree.dropin.FrameContainer = FrameContainer;
})();

(function () {
  function PayPalModalService(options) {
    this.clientToken = options.clientToken;
    this.paypalOptions = options.paypal || {};

    this.client = new braintree.paypal.Client(this.clientToken, {
      locale: this.paypalOptions.locale || 'en',
      singleUse: (this.paypalOptions.singleUse === true) ? true : false
    });
    this.client.insertUI = false;
    this.client.init();

    this.overrideDefaultRPC();

    return this.client;
  }

  PayPalModalService.prototype.overrideDefaultRPC = function () {
    this.client.rpcServer.define('receivePayPalData', braintree.Utils.bind(this.handlePayPalAuthentication, this));
  };

  PayPalModalService.prototype.handlePayPalAuthentication = function () {
    this.client.removeFrame();
  };

  braintree.dropin.PayPalModalService = PayPalModalService;
})();



})(this);

(function (global) {
  var braintree = global.braintree || {};

  braintree.setup = function (clientToken, integration, options) {
    if (integration === 'dropin' || integration === 'paypal') {
      braintree[integration].create(clientToken, options);
    } else if (integration === 'custom') {
      var apiClient = new braintree.api.Client({clientToken: clientToken});
      var form = braintree.Form.setup(apiClient, options);

      if (options.paypal) {
        if (options.paypal.paymentMethodNonceInputField == undefined) {
          options.paypal.paymentMethodNonceInputField = form.paymentMethodNonce;
        }

        braintree.paypal.create(clientToken, options.paypal);
      }
    } else {
      throw new Error(integration + ' is an unsupported integration');
    }
  };
})(this);
