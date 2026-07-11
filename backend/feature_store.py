import random

class FeatureStore:
    """
    Simulated Feast Online Feature Store.
    Provides sub-millisecond retrieval of historical and real-time aggregated features
    for the real-time XGBoost/Heuristic fraud scoring path.
    """
    @staticmethod
    def get_online_features(token: str, amount: float, past_transactions: int) -> dict:
        # Deterministically seed random to return consistent features for the same token
        seed_val = sum(ord(c) for c in token)
        state = random.getstate()
        random.seed(seed_val)
        
        user_velocity_30m = past_transactions + random.randint(0, 1)
        user_velocity_24h = past_transactions + random.randint(1, 4)
        average_amount_24h = amount * (0.8 + random.random() * 0.4) if past_transactions > 0 else 0.0
        device_age_days = random.randint(15, 450) if past_transactions > 0 else 0
        location_mismatch_count_7d = random.randint(0, 1)
        
        features = {
            "user_velocity_30m":          user_velocity_30m,
            "user_velocity_24h":          user_velocity_24h,
            "average_amount_24h":        round(average_amount_24h, 2),
            "device_age_days":            device_age_days,
            "location_mismatch_count_7d": location_mismatch_count_7d,
            "feature_retrieval_latency_ms": round(0.12 + random.random() * 0.15, 3)
        }
        
        random.setstate(state) # restore random state
        return features
