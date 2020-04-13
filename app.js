let express = require('express');
let app = express();
let paypal = require('paypal-rest-sdk');

/**
 * Paypal
 */
paypal.configure({
  'mode': 'sandbox', //sandbox or live
  'client_id': 'AT76aFxLYgvJ1RJ2UyK9lKh1mSPrILNpdE8jhcM5HL40hfGVf2lSgS1gkaoiVjZgYY1h_Di7idzmFXWt',
  'client_secret': 'ELLJTQmVxHGJr022oUDTrgwgxM3cLT23msGS7bMlifV55uzqhjFWrdM5JG_sBXSh7B5MoGi_IMY6VdlT'
});
var bodyParser = require('body-parser')
app.use( bodyParser.json() );   

/**
 * public - имя папки где хранится статика
 */
app.use(express.static('public'));
/**
 *  задаем шаблонизатор
 */
app.set('view engine', 'pug');
/**
* Подключаем mysql модуль
*/
let mysql = require('mysql');
/**
* настраиваем модуль
*/
app.use(express.json());

const nodemailer = require('nodemailer');

let con = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'market'
});

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;


app.listen(3000, function () {
  console.log('node express work on 3000');
});

// app.get("/",  function (req, res) {
//   res.render("navv")
//   });
 
 

app.get('/', function (req, res) {
  
  let cat = new Promise(function (resolve, reject) {
    con.query(
      "select id,name, cost, image, category from (select id,name,cost,image,category, if(if(@curr_category != category, @curr_category := category, '') != '', @k := 0, @k := @k + 1) as ind   from goods, ( select @curr_category := '' ) v ) goods where ind < 3",
      function (error, result, field) {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
  let catDescription = new Promise(function (resolve, reject) {
    con.query(
      "SELECT * FROM category",
      function (error, result, field) {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
  Promise.all([cat, catDescription]).then(function (value) {
    console.log(value[1]);
    res.render('index', {
      goods: JSON.parse(JSON.stringify(value[0])),
      cat: JSON.parse(JSON.stringify(value[1])),
    });
  });
});

app.get('/cat', function (req, res) {
  console.log(req.query.id);
  let catId = req.query.id;

  let cat = new Promise(function (resolve, reject) {
    con.query(
      'SELECT * FROM category WHERE id=' + catId,
      function (error, result) {
        if (error) reject(error);
        resolve(result);
      });
  });
  let goods = new Promise(function (resolve, reject) {
    con.query(
      'SELECT * FROM goods WHERE category=' + catId,
      function (error, result) {
        if (error) reject(error);
        resolve(result);
      });
  });

  Promise.all([cat, goods]).then(function (value) {
    console.log(value[0]);
    res.render('cat', {
      cat: JSON.parse(JSON.stringify(value[0])),
      goods: JSON.parse(JSON.stringify(value[1]))
    });
  })
});

app.get('/goods', function (req, res) {
  console.log(req.query.id);
  con.query('SELECT * FROM goods WHERE id=' + req.query.id, function (error, result, fields) {
    if (error) throw error;
    res.render('goods', { goods: JSON.parse(JSON.stringify(result)) });
  });
});

app.get('/order', function (req, res) {
  res.render('order');
});


app.post('/get-category-list', function (req, res) {
  // console.log(req.body);
  con.query('SELECT id, category FROM category', function (error, result, fields) {
    if (error) throw error;
    console.log(result)
    res.json(result);
  });
});

app.post('/get-goods-info', function (req, res) {
  console.log(req.body.key);
  if (req.body.key.length != 0) {
    con.query('SELECT id,name,cost FROM goods WHERE id IN (' + req.body.key.join(',') + ')', function (error, result, fields) {
      if (error) throw error;
      console.log(result);
      let goods = {};
      for (let i = 0; i < result.length; i++) {
        goods[result[i]['id']] = result[i];
      }
      res.json(goods);
    });
  }
  else {
    res.send('0');
  }
});

app.post('/finish-order', function (req, res) {
  console.log(req.body);
  if (req.body.key.length != 0) {
    let key = Object.keys(req.body.key);
    con.query(
      'SELECT id,name,cost FROM goods WHERE id IN (' + key.join(',') + ')',
      function (error, result, fields) {
        if (error) throw error;
        console.log(result);
        sendMail(req.body, result).catch(console.error);
        saveOrder(req.body, result);
        res.send('1');
        res.render('/pay');
      });
  }
  else {
    res.send('0');
  }
});



app.get('/admin', function (req, res) {
  res.render('admin', {});
});

app.get('/admin-order', function (req, res) {
  con.query(`SELECT 
	shop_order.id as id,
	shop_order.user_id as user_id,
    shop_order.goods_id as goods_id,
    shop_order.goods_cost as goods_cost,
    shop_order.goods_amount as goods_amount,
    shop_order.total as total,
    from_unixtime(date,"%Y-%m-%d %h:%m") as human_date,
    user_info.user_name as user,
    user_info.user_phone as phone,
    user_info.address as address
FROM 
	shop_order
LEFT JOIN	
	user_info
ON shop_order.user_id = user_info.id ORDER BY id DESC`, function (error, result, fields) {
      if (error) throw error;
      console.log(result);
      res.render('admin-order', { order: JSON.parse(JSON.stringify(result)) });
    });
});

function saveOrder(data, result) {
  // data - информация о пользователе
  // result - сведения о товаре
  let sql;
  sql = "INSERT INTO user_info (user_name, user_phone, user_email, address) VALUES ('" + data.username + "','" + data.phone + "','" + data.email + "','" + data.address + "')";
  con.query(sql, function (error, resultQuery) {
    if (error) throw error;
    console.log('1 user info saved');
    console.log(resultQuery);
    let userId = resultQuery.insertId;
    date = new Date() / 1000;
    for (let i = 0; i < result.length; i++) {
      sql = "INSERT INTO shop_order(date, user_id, goods_id,goods_cost, goods_amount, total) VALUES (" + date + "," + userId + "," + result[i]['id'] + "," + result[i]['cost'] + "," + data.key[result[i]['id']] + "," + data.key[result[i]['id']] * result[i]['cost'] + ")";
      con.query(sql, function (error, resultQuery) {
        if (error) throw error;
        
        console.log(result[i]['cost'] * data.key[result[i]['id']])
        console.log("1 goods saved");
      })
    }
  });

}

async function sendMail(data, result) {
  let res = '<h2>Order in lite shop</h2>';
  let total = 0;
  for (let i = 0; i < result.length; i++) {
    res += `<p>${result[i]['name']} - ${data.key[result[i]['id']]} - ${result[i]['cost'] * data.key[result[i]['id']]} lei</p>`;
    total += result[i]['cost'] * data.key[result[i]['id']];
  }
  

  console.log(res);
  res += '<hr>';
  res += `Total ${total} lei`;
  res += `<hr>Phone: ${data.phone}`;
  res += `<hr>Username: ${data.username}`;
  res += `<hr>Address: ${data.address}`;
  res += `<hr>Email: ${data.email}`;
  

  let testAccount = await nodemailer.createTestAccount();

  let transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: testAccount.user, // generated ethereal user
      pass: testAccount.pass // generated ethereal password
      
    }
    
  });

  let mailOption = {
    from: '<botnariniku@gmail.com>',
    to: "botnariniku@gmail.com," + data.email,
    subject: "Lite shop order",
    text: 'Hello world',
    html: res
  };

  let info = await transporter.sendMail(mailOption);
  console.log("MessageSent: %s", info.messageId);
  console.log("PreviewSent: %s", nodemailer.getTestMessageUrl(info));
  return true;
  
};


app.post('/pay', function(  result, res, data)  {
  con.query(`SELECT  sum(total) as total from shop_order group by user_id DESC  
  LIMIT 1`,
   function (error, result, fields) {
    if (error) throw error;
    console.log(result);
   
    Object.keys(result).forEach(function(key) {
      var row = result[key];
      console.log(row.total)
  
  const create_payment_json = {
    
    "intent": "sale",
    "payer": {
        "payment_method": "paypal"
    },
    "redirect_urls": {
        "return_url": "http://localhost:3000/success",
        "cancel_url": "http://localhost:3000/cancel"
    },
    "transactions": [{
        
        "amount": {
            "currency": "USD",
            "total": row.total,
            
        },
        "description": "Hat for the best team ever"
    }]
  
};



paypal.payment.create(create_payment_json, function (error, payment) {
  if (error) {
      throw error;
  } else {
      for(let i = 0;i < payment.links.length;i++){
        if(payment.links[i].rel === 'approval_url'){
          res.redirect(payment.links[i].href);
        }
      }
  }
});

});

app.get('/success', (req, res) => {
  const payerId = req.query.PayerID;
  const paymentId = req.query.paymentId;

  const execute_payment_json = {
    "payer_id": payerId,
    "transactions": [{
        "amount": {
            "currency": "USD",
            "total": "25.00"
        }
    }]
  };

  paypal.payment.execute(paymentId, execute_payment_json, function (error, payment) {
    if (error) {
        console.log(error.response);
        throw error;
    } else {
        console.log(JSON.stringify(payment));
        res.redirect('/');
    }
});
});

});
});