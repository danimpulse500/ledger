const express = require('express');
const app = express();

app.get('/test', (req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from('hello'));
});

app.listen(3123, () => console.log('started'));
