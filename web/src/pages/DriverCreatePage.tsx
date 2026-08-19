import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createDriver, type DriverCreatePayload } from '../api/drivers';
import { apiErrorMessage } from '../api/client';
import { DriverCreateForm } from '../components/DriverForm';

export function DriverCreatePage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (payload: DriverCreatePayload) => {
    setSubmitting(true);
    setError(null);
    try {
      const driver = await createDriver(payload);
      toast.success('Водитель создан');
      navigate(`/drivers/${driver.id}`);
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось создать водителя');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Новый водитель</h2>
          <p className="muted">Те же поля, что в мобильном приложении (email + пароль для входа в APK).</p>
        </div>
        <Link to="/drivers" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <DriverCreateForm submitting={submitting} onSubmit={onSubmit} onCancel={() => navigate('/drivers')} />
    </section>
  );
}
