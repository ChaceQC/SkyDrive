import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Card, message, Typography, Tabs, Row, Col, Space } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import request from '../utils/request';
import { useNavigate } from 'react-router-dom';
import { calculateHash, getClientNonce } from '../utils/crypto';

const { Title, Link } = Typography;

interface CaptchaData {
    id: string;
    captcha: string;
    metadata: {
        t: number;
        n: string;
        s: string;
        cn?: string; // We will add client nonce here
    };
}

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null);
  const [emailId, setEmailId] = useState('');
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const fetchCaptcha = async () => {
      try {
          const res: any = await request.get('/login/captcha');
          if (res.code === 200) {
              setCaptcha(res.data);
              form.setFieldsValue({ v_code: '' }); // Clear captcha input
          }
      } catch (error) {
          message.error('获取验证码失败');
      }
  };

  const handleModeChange = (newMode: 'login' | 'register' | 'reset') => {
      setMode(newMode);
      form.resetFields();
      fetchCaptcha();
      setCountdown(0);
  }

  useEffect(() => {
      fetchCaptcha();
  }, []);

  useEffect(() => {
      // @ts-ignore
      let timer: NodeJS.Timeout;
      if (countdown > 0) {
          timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      }
      return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendEmailCode = async () => {
      try {
          const values = await form.validateFields(['email']);
          const endpoint = mode === 'register' ? '/login/send-email-code' : '/login/send-reset-code';
          
          const res: any = await request.post(endpoint, { email: values.email });
          if (res.code === 200) {
              setEmailId(res.data.id);
              setCountdown(60);
              form.setFieldsValue({ email_code: '' }); // Clear email code input
              message.success('验证码已发送');
          } else {
              message.error(res.message);
          }
      } catch (error) {
          message.error('请先输入正确的邮箱');
      }
  };

  const onFinish = async (values: any) => {
    if (!captcha) {
        message.error('验证码未加载');
        return;
    }

    setLoading(true);
    const clientNonce = getClientNonce();
    const metadata = { ...captcha.metadata, cn: clientNonce };

    try {
        if (mode === 'login') {
            const rawParts = [ captcha.id, values.email, values.password, metadata.s, clientNonce ];
            const hashCode = calculateHash(rawParts, metadata.n);
            const res: any = await request.post('/login/login', {
                email: values.email,
                password: values.password,
                v_id: captcha.id,
                v_code: values.v_code,
                hash_code: hashCode,
                metadata: metadata
            });

            if (res.code === 200) {
                localStorage.setItem('token', res.data.access_token);
                message.success('登录成功');
                navigate('/');
            } else {
                if (res.message.includes('图形验证码')) { message.error('图形验证码错误'); } 
                else { message.error(res.message); }
                fetchCaptcha();
            }

        } else if (mode === 'register') {
            const rawParts = [ captcha.id, emailId, values.email, values.username, values.password, metadata.s, clientNonce ];
            const hashCode = calculateHash(rawParts, metadata.n);
            const res: any = await request.post('/login/register', {
                email: values.email,
                username: values.username,
                password: values.password,
                confirm_password: values.confirm_password,
                v_id: captcha.id,
                v_code: values.v_code,
                email_id: emailId,
                email_code: values.email_code,
                hash_code: hashCode,
                metadata: metadata
            });

            if (res.code === 200) {
                message.success('注册成功，请登录');
                handleModeChange('login');
            } else {
                if (res.message.includes('图形验证码')) { message.error('图形验证码错误'); } 
                else if (res.message.includes('邮箱验证码')) { message.error('邮箱验证码错误'); } 
                else { message.error(res.message); }
                fetchCaptcha();
            }
        } else if (mode === 'reset') {
            const rawParts = [ captcha.id, emailId, values.email, values.new_password, metadata.s, clientNonce ];
            const hashCode = calculateHash(rawParts, metadata.n);
            const res: any = await request.post('/login/reset-password', {
                email: values.email,
                new_password: values.new_password,
                confirm_password: values.confirm_password,
                v_id: captcha.id,
                v_code: values.v_code,
                email_id: emailId,
                email_code: values.email_code,
                hash_code: hashCode,
                metadata: metadata
            });

            if (res.code === 200) {
                message.success('密码重置成功，请登录');
                handleModeChange('login');
            } else {
                if (res.message.includes('图形验证码')) { message.error('图形验证码错误'); } 
                else if (res.message.includes('邮箱验证码')) { message.error('邮箱验证码错误'); } 
                else { message.error(res.message); }
                fetchCaptcha();
            }
        }
    } catch (error) {
        message.error('请求失败');
        fetchCaptcha();
    } finally {
        setLoading(false);
    }
  };

  const renderCaptchaInput = () => (
      <Row gutter={8}>
          <Col span={14}>
              <Form.Item name="v_code" rules={[{ required: true, message: '请输入验证码!' }]}>
                  <Input prefix={<SafetyCertificateOutlined />} placeholder="图形验证码" />
              </Form.Item>
          </Col>
          <Col span={10}>
              <img src={captcha?.captcha} alt="captcha" style={{ width: '100%', height: 32, cursor: 'pointer', borderRadius: 2 }} onClick={fetchCaptcha} />
          </Col>
      </Row>
  );

  const renderEmailInput = () => (
      <>
        <Form.Item name="email" rules={[{ required: true, message: '请输入邮箱!' }, { type: 'email', message: '邮箱格式不正确!' }]}>
            <Input prefix={<MailOutlined />} placeholder="邮箱" />
        </Form.Item>
        <Row gutter={8}>
            <Col span={14}>
                <Form.Item name="email_code" rules={[{ required: true, message: '请输入邮箱验证码!' }]}>
                    <Input prefix={<SafetyCertificateOutlined />} placeholder="邮箱验证码" />
                </Form.Item>
            </Col>
            <Col span={10}>
                <Button onClick={handleSendEmailCode} disabled={countdown > 0} block>
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                </Button>
            </Col>
        </Row>
      </>
  );

  const renderTitle = () => {
      if (mode === 'reset') {
          return (
              <Space align="center" style={{ marginBottom: 24 }}>
                  <Button type="text" shape="circle" icon={<ArrowLeftOutlined />} onClick={() => handleModeChange('login')} />
                  <Title level={3} style={{ margin: 0 }}>忘记密码</Title>
              </Space>
          );
      }
      return <Title level={3} style={{ marginBottom: 24, textAlign: 'center' }}>极速云存储</Title>;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 400 }}>
        {renderTitle()}
        
        {mode !== 'reset' && (
            <Tabs activeKey={mode} onChange={(key) => handleModeChange(key as any)} centered items={[
                { key: 'login', label: '登录' },
                { key: 'register', label: '注册' }
            ]} />
        )}

        <Form form={form} name="login" onFinish={onFinish} layout="vertical" style={{ marginTop: mode !== 'reset' ? 24 : 0 }}>
          {mode === 'login' && (
              <>
                <Form.Item name="email" rules={[{ required: true, message: '请输入邮箱!' }]}>
                    <Input prefix={<UserOutlined />} placeholder="邮箱" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码!' }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                </Form.Item>
                {renderCaptchaInput()}
                <div style={{ textAlign: 'right', marginBottom: 24 }}>
                    <Link onClick={() => handleModeChange('reset')}>忘记密码？</Link>
                </div>
              </>
          )}

          {mode === 'register' && (
              <>
                <Form.Item name="username" rules={[{ required: true, message: '请输入用户名!' }]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名" />
                </Form.Item>
                {renderEmailInput()}
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码!' }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                </Form.Item>
                <Form.Item name="confirm_password" dependencies={['password']} rules={[{ required: true, message: '请确认密码!' }, ({ getFieldValue }) => ({ validator(_, value) { if (!value || getFieldValue('password') === value) { return Promise.resolve(); } return Promise.reject(new Error('两次密码不一致!')); }, }),]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
                </Form.Item>
                {renderCaptchaInput()}
              </>
          )}

          {mode === 'reset' && (
              <>
                {renderEmailInput()}
                <Form.Item name="new_password" rules={[{ required: true, message: '请输入新密码!' }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="新密码" />
                </Form.Item>
                <Form.Item name="confirm_password" dependencies={['new_password']} rules={[{ required: true, message: '请确认新密码!' }, ({ getFieldValue }) => ({ validator(_, value) { if (!value || getFieldValue('new_password') === value) { return Promise.resolve(); } return Promise.reject(new Error('两次密码不一致!')); }, }),]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" />
                </Form.Item>
                {renderCaptchaInput()}
              </>
          )}

          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ width: '100%' }} loading={loading}>
              {mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码'}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Login;