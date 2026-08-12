async function test() {
  try {
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'supervisor@stock.com', password: 'Supervisor@123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;

    // Issue a product
    const productsRes = await fetch('http://localhost:5000/api/products', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const products = await productsRes.json();
    const product = products.find(p => p.quantity > 0);

    const issueRes = await fetch('http://localhost:5000/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        productId: product._id,
        quantity: 1,
        recipient: "Test Recipient",
        purpose: "Testing Return"
      })
    });
    const issueData = await issueRes.json();
    console.log("Created issue:", issueData.issue._id);

    // Return the product
    const ret1 = await fetch(`http://localhost:5000/api/issues/${issueData.issue._id}/return`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    const ret1Data = await ret1.json();
    console.log("First return:", ret1.status, ret1Data.message);

    // Try returning again (simulate double click)
    const ret2 = await fetch(`http://localhost:5000/api/issues/${issueData.issue._id}/return`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    const ret2Data = await ret2.json();
    console.log("Second return:", ret2.status, ret2Data.message);

  } catch (err) {
    console.error("Error:", err.message);
  }
}
test();
