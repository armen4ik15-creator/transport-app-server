import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getDriverById, updateDriver, type DriverUpdatePayload } from '../api/drivers';
import { apiErrorMessage } from '../api/client';
import { DriverEditForm } from '../components/DriverForm';
import type { Driver } from '../types';

export function DriverEditPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setError('Некорректный ID водителя');
      return;
    }
    setError(null);
    const found = await getDriverById(id);
    if (!found) {
      setError('Водитель не найден');
      setDriver(null);
      return;
    }
    setDriver(found);
  }, [id]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить водителя')))
      .finally(() => setLoading(false));
  }, [load]);

  const onSubmit = async (payload: DriverUpdatePayload) => {
    setSubmitting(true);
    setError(null);
    try {
      await updateDriver(id, payload);
      toast.success('Изменения сохранены');
      navigate(`/drivers/${id}`);
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось сохранить изменения');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="muted">Загрузка…</p>;
  }

  if (!driver) {
    return (
      <section>
        <p className="error">{error ?? 'Водитель не найден'}</p>
        <Link to="/drivers" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </section>
    );
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Редактирование: {driver.full_name ?? driver.email}</h2>
          <p className="muted">Деактивация — снимите галочку «Активен» и сохраните.</p>
        </div>
        <Link to={`/drivers/${id}`} className="btn-secondary link-btn">
          ← К карточке
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <DriverEditForm
        driver={driver}
        submitting={submitting}
        onSubmit={onSubmit}
        onCancel={() => navigate(`/drivers/${id}`)}
      />
    </section>
  );
}
