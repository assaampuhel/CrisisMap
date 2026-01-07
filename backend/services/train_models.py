# train_models.py
import pandas as pd
from pathlib import Path
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import numpy as np

MODELS_DIR = Path("backend/services/models")
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# 1) Train severity model
def train_severity(csv_path):
    df = pd.read_csv(csv_path)
    texts = df['text'].fillna("").astype(str).tolist()
    labels = df['label'].astype(str).tolist()
    vec = TfidfVectorizer(ngram_range=(1,2), max_features=8000)
    X = vec.fit_transform(texts)
    clf = LogisticRegression(max_iter=1000)
    clf.fit(X, labels)
    joblib.dump({"model": clf, "vectorizer": vec}, MODELS_DIR / "severity_model.joblib")
    print("Saved severity_model.joblib")

# 2) Train assignment model (binary label 0/1)
def train_assignment(csv_path):
    df = pd.read_csv(csv_path)
    X = df[['severity_norm','distance_km','team_load']].astype(float).values
    y = df['label'].astype(int).values
    clf = LogisticRegression(max_iter=1000)
    clf.fit(X, y)
    joblib.dump(clf, MODELS_DIR / "assignment_model.joblib")
    print("Saved assignment_model.joblib")

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--sev_csv", default="backend/services/models/severity_data.csv")
    p.add_argument("--ass_csv", default="backend/services/models/assignment_data.csv")
    args = p.parse_args()
    train_severity(args.sev_csv)
    train_assignment(args.ass_csv)
