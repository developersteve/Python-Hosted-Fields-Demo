import braintree

from flask import Flask, render_template, send_from_directory, request
app = Flask(__name__)

braintree.Configuration.configure(
    braintree.Environment.Sandbox,
    "23nd25g4kn7gnqbb",
    "8552x2ym5bvhsycp",
    "17f3279171d4fd90ee9cd5256be17abf"
)

@app.route("/")
def index():

    # Generate client token for the dropin ui
    client_token = braintree.ClientToken.generate({})

    return render_template('index.html', token=client_token)

@app.route("/proc", methods=['GET', 'POST'])
def proc():

    result = braintree.Transaction.sale({
        "amount": request.form["amount"],
        "payment_method_nonce": request.form["payment_method_nonce"]
    })

    return render_template('proc.html', result=result, request=request.form)

@app.route('/public/<path:path>')
def send_public(path):
    return send_from_directory('public', path)

if __name__ == "__main__":
    app.run()
